const { WebSocketServer, WebSocket } = require('ws');

// Railway automatically injects the PORT environment variable
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

// Helper to safely send JSON messages without throwing errors if the socket closed
function safeSend(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data), (err) => {
            if (err) console.error('Failed to send message:', err.message);
        });
    }
}

function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', (ws) => {
    ws.roomCode = null;
    ws.isAlive = true;

    // Keep-alive heartbeat listener
    ws.on('pong', heartbeat);

    // CRITICAL: Catches socket-level errors to prevent the entire server from crashing
    ws.on('error', (err) => {
        console.error('Socket error:', err.message);
    });

    ws.on('message', (message) => {
        let data;
        try { 
            data = JSON.parse(message); 
        } catch (e) { 
            return; // Ignore malformed JSON
        }

        switch (data.type) {
            case 'create_room': {
                let code = generateRoomCode();
                while (rooms.has(code)) code = generateRoomCode();
                
                rooms.set(code, { host: ws, guest: null });
                ws.roomCode = code;
                safeSend(ws, { type: 'room_created', code });
                break;
            }

            case 'join_room': {
                const code = data.code?.toUpperCase();
                const room = rooms.get(code);

                if (!room) {
                    safeSend(ws, { type: 'error', message: 'Room not found.' });
                    return;
                }
                if (room.guest !== null) {
                    safeSend(ws, { type: 'error', message: 'Room is full.' });
                    return;
                }

                room.guest = ws;
                ws.roomCode = code;

                safeSend(ws, { type: 'room_joined', code });
                safeSend(room.host, { type: 'opponent_joined' });
                break;
            }

            case 'game_setup':
            case 'move': {
                const room = rooms.get(ws.roomCode);
                if (!room) return;

                const recipient = (ws === room.host) ? room.guest : room.host;
                safeSend(recipient, data);
                break;
            }
        }
    });

    ws.on('close', () => {
        if (!ws.roomCode || !rooms.has(ws.roomCode)) return;

        const room = rooms.get(ws.roomCode);
        const opponent = (ws === room.host) ? room.guest : room.host;

        // Notify the remaining player that their opponent left
        safeSend(opponent, { type: 'player_left' });

        // Clean up room from memory
        rooms.delete(ws.roomCode);
    });
});

// Server-level error handler
wss.on('error', (err) => {
    console.error('WebSocket Server error:', err.message);
});

// Ping clients every 30 seconds to clean up dead / AFK dropped connections
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            // Socket failed to respond to the previous ping; terminate it
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

console.log(`Relay server running on port ${PORT}`);