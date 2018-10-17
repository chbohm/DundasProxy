import * as express from 'express';
import * as urlParser from 'url';
import * as httpProxy from 'http-proxy';
import * as https from 'https';
import * as fs from 'fs';


const proxy_ = httpProxy.createProxy();


let app = express();
let urlToProxy = process.argv[process.argv.length - 2];
let port = process.argv[process.argv.length - 1];

console.log('Starting PROXY to: ' + urlToProxy);

let url = urlParser.parse(urlToProxy);
let options = {
    key: fs.readFileSync('./key.pem', 'utf8'),
    cert: fs.readFileSync('./server.crt', 'utf8')
};

https.createServer(options, app).listen(port);
app.use('/', handleRequest);

function handleRequest(req: any, res: any, next: any) {
    return proxy_.web(req, res, { target: `${url.protocol}//${url.hostname}:${url.port}` }, (error) => {
        writeError(error, res);
    });
}

function writeError(error: Error, res: any) {
    res.writeHead(500, {
        'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({ error: error.message }, null, 2));
}

