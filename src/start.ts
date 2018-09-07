import * as express from 'express';
import * as bodyParserModule from 'body-parser';
import * as request from 'request';
import * as urlParser from 'url';
import * as httpProxy from 'http-proxy';
const proxy_ = httpProxy.createProxy();

const ONE_HOUR_MILLIS = 3600000;
const HS_36 = ONE_HOUR_MILLIS * 36;
const API_HEADER = 'api';
const DASHBOARD_HEADER = 'dashboard';
let expirationTime = HS_36;

let app = express();
let dundarUrl = process.argv[process.argv.length - 2];
let port = process.argv[process.argv.length - 1];

console.log('Starting PROXY to: ' + dundarUrl);

let url = urlParser.parse(dundarUrl);

interface DundasLoginResponseCacheItem {
    loginResponse: DundasRequestResponse;
    timeStampMillis: number;
}

interface DundasRequestResponse {
    statusCode: number;
    body: any;
    headers: any;
}


let apiLoginResponses = new Map<string, DundasLoginResponseCacheItem>();
let dashboardLoginResponses = new Map<string, DundasLoginResponseCacheItem>();
const bodyParser = bodyParserModule.json();

app.use('/', handleRequest);
app.listen(port);

function handleRequest(req: any, res: any, next: any) {
    console.log('Handling request ', req.path);
    try {
        if (req.path === url.path + '/Api/LogOn') {
            // if it is found a cached loginResp
            return processLogin(req, res).then((response: DundasRequestResponse) => {
                writeResult(response.body, response.headers, res, response.statusCode);
            });
        } if (req.path === '/sessions') {

            writeResult(JSON.stringify([[...dashboardLoginResponses], [...apiLoginResponses]], null, 2), { 'Content-Type': 'application/json' }, res, 200);
        } else {
            return proxy_.web(req, res, { target: `${url.protocol}//${url.hostname}:${url.port}` }, (error) => {
                writeError(error, res);
            });
        }
    } catch (error) {
        console.error(error);
        return writeError(error, res);
    }
}

async function requestToDundas(origReq: any, origResponse: any): Promise<DundasRequestResponse> {
    return await sendRequestToDundas(createRequestOptions(origReq));
}
function createRequestOptions(origReq: any) {
    const body = isEmpty(origReq.body) ? undefined : origReq.body;
    const qs = isEmpty(origReq.query) ? undefined : origReq.query;
    return {
        url: `${url.protocol}//${url.hostname}:${url.port}${origReq.url}`,
        method: origReq.method,
        json: body,
        qs: qs
    };

}
async function sendRequestToDundas(requestOptions: any): Promise<DundasRequestResponse> {
    return new Promise<DundasRequestResponse>((resolve, reject) => {
        try {
            request(requestOptions, (error: Error, response: any, body: Buffer) => {
                if (error) {
                    return reject(error);
                }
                resolve({
                    statusCode: response.statusCode,
                    body: body,
                    headers: response.headers
                });
            });
        } catch (error) {
            reject(error);
        }
    });
}

async function redBody(req: any): Promise<any> {
    return new Promise((resolve, reject) => {
        bodyParser(req, null, (err: any) => {
            if (err) {
                reject(err);
            } else {
                resolve(req.body);
            }
        });
    });
}

async function processLogin(req: any, res: any): Promise<DundasRequestResponse> {
    await redBody(req);
    let loginType = req.headers[`login-type`] || DASHBOARD_HEADER;
    let accountName = req.body.accountName;
    validate(loginType, accountName);
    let cacheMap: Map<string, DundasLoginResponseCacheItem>;
    switch (loginType) {
        case API_HEADER: cacheMap = apiLoginResponses; break;
        case DASHBOARD_HEADER: cacheMap = dashboardLoginResponses; break;
    }
    let cachedLoginResponse = await getCachedLoginResponse(accountName, cacheMap);
    if (cachedLoginResponse) {
        console.log('Cached Login response Found', JSON.stringify(cachedLoginResponse.loginResponse, null, 2));
        return cachedLoginResponse.loginResponse;
    } else {
        console.log('Retrieving new login from Dundas');
        let dundasResponse: DundasRequestResponse = await requestToDundas(req, res);
        if (dundasResponse.statusCode === 200) {
            cacheDundasLoginResponse(accountName, cacheMap, dundasResponse);
        }
        return dundasResponse;
    }
}

function cacheDundasLoginResponse(accountName: string, cachedResponses: Map<string, DundasLoginResponseCacheItem>, dundasLoginResponse: DundasRequestResponse) {
    if (dundasLoginResponse.body.sessionId) {
        let cachedResponse: DundasLoginResponseCacheItem = {
            loginResponse: dundasLoginResponse,
            timeStampMillis: Date.now()
        };
        cachedResponses.set(accountName, cachedResponse);
    }

}


async function getCachedLoginResponse(accountName: string, map: Map<string, DundasLoginResponseCacheItem>): Promise<DundasLoginResponseCacheItem> {
    let cachedLoginResponse = map.get(accountName);
    if (cachedLoginResponse) {
        if (shouldRefreshSessions(cachedLoginResponse)) {
            await removeSessionFromDundas(cachedLoginResponse.loginResponse.body.sessionId);
            // the session must be refreshed so we are returned an undefined cachedLoginResponse
            return undefined;
        }
        return cachedLoginResponse;
    }
}

function shouldRefreshSessions(loginResponse: DundasLoginResponseCacheItem): boolean {
    return Date.now() > loginResponse.timeStampMillis + expirationTime;
}


async function removeSessionFromDundas(sessionId: string) {
    try {
        console.log(`Session ${sessionId} expired. Removing from dundas...`);
        const requestOptions = {
            url: url.path + '/Api/Session/Current',
            method: 'DELETE',
            qs: { sessionId: sessionId }
        };
        await sendRequestToDundas(requestOptions);
    } catch (error) {
        console.log('Error while removing session ', error);
    }
}


function validate(loginType: string, accountName: string) {
    if (!loginType) {
        throw new Error('Missing header login-type:API|DASHBOARD');
    }
    if (loginType !== API_HEADER && loginType !== DASHBOARD_HEADER) {
        throw new Error(`Unknown login-type: ${loginType}.`);
    }
    if (!accountName) {
        throw new Error('Missing accountName in login body object');
    }
}

function writeError(error: Error, res: any) {
    res.writeHead(500, {
        'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({ error: error.message }, null, 2));
}

function writeResult(body: any, headers: any, res: any, statusCode: number = 200) {
    res.status(statusCode).json(body);
}

function isEmpty(obj: any) {
    return Object.keys(obj).length === 0 && obj.constructor === Object;
}
