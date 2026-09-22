const { WebSocketServer } = require('ws');

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

wss.on('connection', (ws) => {
    ws.roomCode = null;

    ws.on('message', (message) => {
        let data;
        try { data = JSON.parse(message); } catch (e) { return; }

        switch (data.type) {
            case 'create_room': {
                let code = generateRoomCode();
                while (rooms.has(code)) code = generateRoomCode();
                rooms.set(code, { host: ws, guest: null });
                ws.roomCode = code;
                ws.send(JSON.stringify({ type: 'room_created', code }));
                break;
            }

            case 'join_room': {
                const code = data.code?.toUpperCase();
                const room = rooms.get(code);
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
                    return;
                }
                if (room.guest !== null) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room is full.' }));
                    return;
                }
                room.guest = ws;
                ws.roomCode = code;
                ws.send(JSON.stringify({ type: 'room_joined', code }));
                room.host.send(JSON.stringify({ type: 'opponent_joined' }));
                break;
            }

            case 'game_setup':
            case 'move': {
                const room = rooms.get(ws.roomCode);
                if (!room) return;
                const recipient = (ws === room.host) ? room.guest : room.host;
                if (recipient && recipient.readyState === ws.OPEN) {
                    recipient.send(JSON.stringify(data));
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        if (!ws.roomCode || !rooms.has(ws.roomCode)) return;
        const room = rooms.get(ws.roomCode);
        const opponent = (ws === room.host) ? room.guest : room.host;
        if (opponent && opponent.readyState === ws.OPEN) {
            opponent.send(JSON.stringify({ type: 'player_left' }));
        }
        rooms.delete(ws.roomCode);
    });
});

console.log(`Relay server running on port ${PORT}`);