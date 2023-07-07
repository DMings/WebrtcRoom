const path = require('path');
const express = require('express');
const ws = require('ws');
const { URL } = require('url');
const http = require('http');
const app = express();


var httpUrl = "http://localhost:8443/"
var wsUrl = "ws://localhost:8443/one2one"

var userRegistry = new UserRegistry();
var idCounter = 0;

function nextUniqueId() {
    idCounter++;
    return idCounter.toString();
}


function UserSession(id, name, ws) {
    this.id = id;
    this.name = name;
    this.toName = null;
    this.ws = ws;
}

UserSession.prototype.sendMessage = function (message) {
    this.ws.send(JSON.stringify(message));
}

// Represents registrar of users
function UserRegistry() {
    this.usersById = {};
    this.usersByName = {};
}

UserRegistry.prototype.register = function (user) {
    this.usersById[user.id] = user;
    this.usersByName[user.name] = user;
}

UserRegistry.prototype.unregister = function (id) {
    var user = this.getById(id);
    if (user) delete this.usersById[id]
    if (user && this.getByName(user.name)) delete this.usersByName[user.name];
}

UserRegistry.prototype.getById = function (id) {
    return this.usersById[id];
}

UserRegistry.prototype.getByName = function (name) {
    return this.usersByName[name];
}

UserRegistry.prototype.removeById = function (id) {
    var userSession = this.usersById[id];
    if (!userSession) return;
    delete this.usersById[id];
    delete this.usersByName[userSession.name];
}

/*
 * Server startup
 */

var { port } = new URL(httpUrl);
const { pathname } = new URL(wsUrl);
var server = http.createServer(app).listen(port, function () {
    console.log('Open ' + httpUrl + ' with a WebRTC Room');
    console.log('Open ' + wsUrl + ' server');
});

var wss = new ws.Server({
    server: server,
    path: pathname
});

wss.on('connection', function (ws) {
    var sessionId = nextUniqueId();
    console.log('Connection received with sessionId ' + sessionId);

    ws.on('error', function (error) {
        console.log('Connection ' + sessionId + ' error');
        leaveRoom(sessionId);
    });

    ws.on('close', function () {
        console.log('Connection ' + sessionId + ' closed');
        leaveRoom(sessionId);
    });

    ws.on('message', function (_message) {
        var message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.action) {
            case 'join':
                joinRoom(sessionId, message.from, ws);
                break;

            case 'call':
                callUser(sessionId, message.to, message.from, message.msg);
                break;

            case 'incomingCall':
                incomingCallUser(sessionId, message.to, message.from, message.msg);
                break;

            case 'send':
                sendUserMsg(sessionId, message.to, message.from, message.msg);
                break;

            case 'leave':
                leaveRoom(sessionId, message.to, message.from);
                break;

            default:
                ws.send(JSON.stringify({
                    id: 'error',
                    message: 'Invalid message ' + message
                }));
                break;
        }

    });
});


function joinRoom(id, name, ws) {
    function onError(error) {
        ws.send(JSON.stringify({ id: 'joinResponse', response: 'reject ', message: error }));
    }

    if (userRegistry.getById(id)) {
        return onError("SessionId " + id + " is already registered");
    }

    if (!name) {
        return onError("empty user name");
    }

    if (userRegistry.getByName(name)) {
        return onError("User " + name + " is already registered");
    }

    userRegistry.register(new UserSession(id, name, ws));
    try {
        ws.send(JSON.stringify({ id: 'joinResponse', response: 'accept' }));
    } catch (exception) {
        onError(exception);
    }
}


function callUser(id, to, from) {
    var caller = userRegistry.getById(id);
    var rejectCause = 'User ' + to + ' is not registered';
    var toUser = userRegistry.getByName(to);
    var callSuccess = false;
    if (toUser) {
        var message = {
            action: 'toCall',
            from: from
        };
        callSuccess = true;
        try {
            toUser.sendMessage(message);
        } catch (exception) {
            rejectCause = "Error " + exception;
            callSuccess = false;
        }
    }
    var message = undefined;
    if (callSuccess) {
        message = {
            action: 'callResponse',
            response: 'success',
        };
    } else {
        message = {
            action: 'callResponse',
            response: 'rejected',
            message: rejectCause
        };
    }

    caller.sendMessage(message);
}


function incomingCallUser(id, to, from, msg) {
    var caller = userRegistry.getById(id);
    var toUser = userRegistry.getByName(to);
    var callSuccess = false;
    if (toUser) {
        var message = {
            action: 'toInComingCall',
            from: from,
            message: msg
        };
        callSuccess = true;
        try {
            toUser.sendMessage(message);
        } catch (exception) {
            callSuccess = false;
        }
    }
    var message = undefined;
    if (callSuccess) {
        message = {
            action: 'inComingResponse',
            response: 'success'
        };
    } else {
        message = {
            action: 'inComingResponse',
            response: 'error'
        };
    }

    caller.sendMessage(message);
}

function sendUserMsg(id, to, from, msg) {
    var caller = userRegistry.getById(id);
    var toUser = userRegistry.getByName(to);
    var callSuccess = false;
    if (toUser) {
        var message = {
            action: 'toSend',
            from: from,
            message: msg
        };
        callSuccess = true;
        try {
            toUser.sendMessage(message);
        } catch (exception) {
            callSuccess = false;
        }
    }
    var message = undefined;
    if (callSuccess) {
        message = {
            action: 'sendResponse',
            response: 'success'
        };
    } else {
        message = {
            action: 'sendResponse',
            response: 'error'
        };
    }

    caller.sendMessage(message);
}


function leaveRoom(id, to, from) {
    if (to && from) {
        var toUser = userRegistry.getByName(to);
        var callSuccess = false;
        if (toUser) {
            var message = {
                action: 'toLeave',
                from: from,
            };
            callSuccess = true;
            try {
                toUser.sendMessage(message);
            } catch (exception) {
                callSuccess = false;
            }
        }
        var message = undefined;
        if (callSuccess) {
            message = {
                action: 'leaveResponse',
                response: 'success'
            };
        } else {
            message = {
                action: 'leaveResponse',
                response: 'error'
            };
        }
    }
    userRegistry.unregister(id);
}

app.get('/', function (req, res) {
    res.send('Webrtc Room!');
})
