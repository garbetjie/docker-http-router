// Usage: ./index.js [-port 80] [-host {[network/container]/[container_name]}:{target_port}]
import * as containers from './containers.js';

import * as http from 'http';
import * as url from 'url';
import fetch from 'node-fetch';
import * as zlib from 'zlib';
import {PassThrough} from "stream";

// Get the config.

// Get map of all possible host names => ip.
// containers.list(), containers.reload(), containers.add('name', 'ip'),

const httpServer: http.Server = new http.Server(
    (req, res) => {
        let hostname: string|undefined = req.headers.host;

        // Must have a URL property.
        if (!req.url || !req.method) {
            res.writeHead(400, undefined, { "Content-Type": "text/plain" });
            res.end('[ERROR] Invalid request.');
            return;
        }

        // Must have a host header.
        if (!hostname) {
            res.writeHead(400, undefined, { "Content-Type": "text/plain" });
            res.end('[ERROR] Cannot determine hostname.');
            return;
        }

        // Remove the port if present.
        if (hostname.indexOf(':') > -1) {
            hostname = hostname.split(':')[0];
        }

        const addresses = containers.addresses();
        const address = addresses[hostname];

        if (!address) {
            res.writeHead(500, undefined, { "Content-Type": "text/plain" });
            res.end(`[ERROR] No target container found for ${hostname}.`);
            return;
        }

        // Read incoming body.
        let incomingMessageBody = '';
        req.on('data', c => incomingMessageBody += c.toString());

        // Send outgoing request.
        req.on('end', () => {
            const method = (req.method || '').toUpperCase();
            const targetUri = `http://${address}${req.url || '/'}`;

            // Populate the headers.
            const headers: Record<string, string> = JSON.parse(JSON.stringify(req.headers));
            hostname && (headers['host'] = hostname);

            fetch(targetUri, {
                headers,
                redirect: "follow",
                timeout: 10000,
                body: ['HEAD', 'GET'].indexOf(method) > -1 ? undefined : incomingMessageBody,
                method: method
            }).then(
                async (outgoingResponse) => {
                    res.writeHead(outgoingResponse.status, outgoingResponse.statusText, JSON.parse(JSON.stringify(outgoingResponse.headers)));
                    res.end(await outgoingResponse.text());
                },
                err => {
                    res.writeHead(500, undefined, { "Content-Type": "text/plain" });
                    res.end(`[ERROR] Unable to complete request: ${err.message}`);
                }
            );
        });
    }
);

httpServer.on('listening', () => {
    console.log('Ready for connections.');
});

process.on('SIGINT', () => {
    console.log('Shutting down.');
    process.exit(0);
})

httpServer.listen(80);
