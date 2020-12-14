import * as docker from './docker.js';

let containers: docker.Container[] = [];
let thisContainer: docker.Container;

// Perform the initial load of containers.
docker.ps().then(
    ids => Promise.all(ids.map(id => docker.inspect(id)))
).then(
    c => {
        containers = c;

        // If we have the HOSTNAME populated, then we can attempt to match this container (the routing container).
        if (process.env.hasOwnProperty('HOSTNAME')) {
            containers.forEach(
                container => {
                    if (!thisContainer && container.Hostname === process.env.HOSTNAME) {
                        thisContainer = container;
                    }
                }
            )
        }
    }
);

// Network connect - refresh container.
docker.events.on('network.connect', async (networkId: string, containerId: string) => {
    const container = await docker.inspect(containerId);

    containers = containers.filter(c => c.Id !== containerId).concat([container]);
});

// Network disconnect - refresh container.
docker.events.on('network.disconnect', async (networkId: string, containerId: string) => {
    const container = await docker.inspect(containerId);

    containers = containers.filter(c => c.Id !== containerId).concat([container]);

    // TODO Disconnect router from network if it is the only one still connected.
});

// Container destroyed - remove from the list of containers.
docker.events.on('container.destroy', async (containerId: string) => {
    containers = containers.filter(c => c.Id !== containerId);
});

// Network created - attach this router container to it.
docker.events.on('network.create', async (networkId: string) => {
    if (thisContainer) {
        docker.network.connect(networkId, thisContainer.Id).catch(
            () => {
                console.error('Failed to connect to newly-created network.');
            }
        );
    }
});

/**
 * Looks up the IP address for the given host name.
 *
 * @param {String} host
 * @returns {String|undefined}
 */
export function lookup(host: string): string|undefined {
    return containers.map(
        (container): string|undefined => {
            const hostMap = resolveContainerHostnames(container);

            if (hostMap.hasOwnProperty(host)) {
                return hostMap[host];
            }
        }
    ).filter(v => !!v).find(v => v);
}

export function addresses(): Record<string, string> {
    const map: Record<string, string> = {};

    containers.forEach(
        container => {
            Object.entries(resolveContainerHostnames(container)).forEach(
                ([name, address]) => {
                    map[name] = address;
                }
            );
        }
    );

    return map;
}

/**
 * Returns all the possible host names for the given container.
 *
 * Possible combinations include:
 *  - {Id}.docker
 *  - {Name}.docker
 *  - {docker-compose service}.{docker-compose project}.docker
 *  - {alias1..aliasN}.{network}.docker
 * @param container
 */
function resolveContainerHostnames(container: docker.Container): Record<string, string> {
    const map: Record<string, string> = {};

    if (container.IPAddress) {
        map[container.Id] = container.IPAddress;
        map[container.Name.replace(/^\//, "")] = container.IPAddress;
    }

    // Handy function used to populate the Id and Name values with the given IP address.
    const fill = (ip: string) => {
        [container.Id, container.Name.replace(/^\//, "")].forEach(
            key => {
                if (!map.hasOwnProperty(key)) {
                    map[key] = ip;
                }
            }
        );
    }

    const composeNetworkNames: string[] = [];

    // Check for docker-compose labels, and add the network IP addresses to the map.
    if (container.Config.Labels.hasOwnProperty('com.docker.compose.project') && container.Config.Labels.hasOwnProperty('com.docker.compose.service')) {
        const compose: [string, string] = [
            container.Config.Labels['com.docker.compose.service'],
            container.Config.Labels['com.docker.compose.project'],
        ];

        Object.keys(container.NetworkSettings.Networks)
            .filter((n: string) => n.indexOf(`${compose[1]}_`) === 0)
            .forEach(
                (networkName: string) => {
                    const ip = container.NetworkSettings.Networks[networkName].IPAddress;

                    composeNetworkNames.push(networkName);
                    map[compose.join('.')] = ip;
                    fill(ip);
                }
            );
    }

    // Check for network aliases.
    for (let name in container.NetworkSettings.Networks) {
        if (!container.NetworkSettings.Networks.hasOwnProperty(name) || composeNetworkNames.indexOf(name) > -1) {
            continue;
        }

        const ip = container.NetworkSettings.Networks[name].IPAddress;

        // Populate the aliases.
        (container.NetworkSettings.Networks[name].Aliases || []).forEach(
            (alias: string) => {
                map[`${alias}.${name}`] = ip;
                fill(ip);
            }
        );

        // Fall back to filling up.
        fill(ip);
    }

    return Object.fromEntries(
        Object.entries(map).map(
            ([name, ip]) => {
                return [name + '.docker', ip];
            }
        )
    );
}
