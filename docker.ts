import * as http from 'http';
import {EventEmitter} from "events";

async function dockerCall(method: 'GET'|'POST', path: string, body?: string): Promise<http.IncomingMessage> {
    return new Promise(
        (resolve, reject) => {
            const request = http.request(
                `http://localhost/${path.toString().replace(/\/+/, "")}`,
                {
                    method,
                    socketPath: '/var/run/docker.sock'
                },
                response => {
                    resolve(response);
                }
            );

            if (method === 'POST') {
                request.write(body);
            }

            request.end();

            // Any errors should reject the promise.
            request.on('error', e => {
                reject(e);
            });
        }
    );
}

export async function inspect(id: string): Promise<Container> {
    return await parse(await dockerCall('GET', `/containers/${id}/json`));
}

export async function ps(): Promise<string[]> {
    const parsed: Container[] = await parse(await dockerCall('GET', '/containers/json'));

    return parsed.map(c => c.Id);
}

function parse(response: http.IncomingMessage): Promise<any> {
    return new Promise(
        (resolve, reject) => {
            let body = '';
            response.on('data', c => body += c);
            response.on('end', () => resolve(JSON.parse(body)));
            response.on('error', reject);
        }
    )
}

export const events = new class extends EventEmitter {
    constructor() {
        super();

        dockerCall('GET', '/events?type=network&type=container').then(
            response => {
                // Do nothing if an invalid response was received.
                if (response.statusCode !== 200) {
                    return;
                }

                response.on('data', c => {
                    const event: Event = JSON.parse(c);
                    const args = [];

                    // Network events.
                    if (event.Type === 'network') {
                        if (["connect", "disconnect"].indexOf(event.Action) > -1) {
                            args.push(event.Actor.ID, event.Actor.Attributes.container);
                        }

                        if (["create"].indexOf(event.Action) > -1) {
                            args.push(event.Actor.ID);
                        }
                    }

                    // Container events.
                    if (event.Type === 'container') {
                        if (["destroy"].indexOf(event.Action) > -1) {
                            args.push(event.Actor.ID);
                        }
                    }

                    events.emit(`${event.Type}.${event.Action}`, ...args);
                });
            }
        );
    }
};

export const network = {
    connect(network: string, container: string): Promise<Container> {
        return dockerCall(
            'POST',
            `/networks/${network}/connect`,
            JSON.stringify({ Container: container })
        ).then(
            async res => {
                if (res.statusCode !== 200) {
                    throw new Error(`Non-200 status code encountered connecting container to network [statusCode=${res.statusCode}]`);
                }

                return await inspect(container);
            }
        );
    },

    disconnect(network: string, container: string): Promise<Container> {
        return dockerCall(
            'POST',
            `/networks/${network}/disconnect`,
            JSON.stringify({ Container: container })
        ).then(
            async res => {
                if (res.statusCode !== 200) {
                    throw new Error(`Non-200 status code encountered disconnecting container from network [statusCode=${res.statusCode}]`);
                }

                return await inspect(container);
            }
        );
    }
}

type Event = {
    Type: 'container' | 'network',
    Action: string,
    Actor: {
        ID: string,
        Attributes: {
            container?: string
        }
    }
}

export type Container = {
    Id: string,
    Name: string,
    Hostname: string,
    IPAddress: string,
    Config: {
        Labels: Record<string, string>
    },
    NetworkSettings: {
        Networks: Record<string, { Aliases: null|string[], IPAddress: string }>
    }
};
