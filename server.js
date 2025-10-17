import express from "express";
import http from "http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const nanoid = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);

// In-memory state
const rooms = new Map();
/*
room = {
    code, hostId, prompts: [], usedPromptIdxs: Set(),
    players: Map<socketId, {name, score, connected}>,
    status: "lobby"|"round"|"reveal"|"finished",
    round: { promptIdx, votes: Map<voterId -> targetId> } | null,
    winningScore: number
}
*/

function getRoomSafeSnapshot(room) {
    return {
        code: room.code,
        status: room.status,
        winningScore: room.winningScore,
        players: Array.from(room.players.entries()).map(([id, p]) => ({
            id, name: p.name, score: p.score, connected: p.connected
        })),
        usedPromptCount: room.usedPromptIdxs.size,
        totalPrompts: room.prompts.length,
        currentPrompt: room.round ? room.prompts[room.round.promptIdx] : null
    };
}

function pickNextPromptIdx(room) {
    if (!room.prompts.length) return null;
    if (room.usedPromptIdxs.size === room.prompts.length) return null;
    let idx;
    do idx = Math.floor(Math.random() * room.prompts.length);
    while (room.usedPromptIdxs.has(idx));
    return idx;
}

io.on("connection", (socket) => {
    // Host creates a room
    socket.on("host:createRoom", ({ winningScore = 10 }) => {
        const code = nanoid();
        const room = {
            code,
            hostId: socket.id,
            prompts: [],
            usedPromptIdxs: new Set(),
            players: new Map(),
            status: "lobby",
            round: null,
            winningScore: Math.max(1, Math.min(50, Number(winningScore) || 10))
        };
        rooms.set(code, room);
        socket.join(code);
        socket.emit("host:roomCreated", { code, snapshot: getRoomSafeSnapshot(room) });
    });

    // HOST updates prompts (newline-separated)
    socket.on("host:setPrompts", ({ code, raw }) => {
        const room = rooms.get(code);
        if (!room || room.hostId !== socket.id) return;
        const lines = (raw || "").split("\n").map(s => s.trim()).filter(Boolean);
        room.prompts = lines;
        room.usedPromptIdxs.clear();
        io.to(code).emit("room:update", getRoomSafeSnapshot(room));
    });

    // Player joins
    socket.on("player:join", ({ code, name }) => {
        code = (code || "").toUpperCase().trim();
        name = (name || "").trim().slice(0, 20);
        const room = rooms.get(code);
        if (!room || !name) {
            socket.emit("player:joinResult", { ok: false, error: "Invalid code or name." });
            return;
        }
        socket.join(code);
        room.players.set(socket.id, { name, score: 0, connected: true });
        socket.emit("player:joinResult", { ok: true, code, name, snapshot: getRoomSafeSnapshot(room) });
        io.to(code).emit("room:update", getRoomSafeSnapshot(room));
    });

    // Host starts a round
    socket.on("host:startRound", ({ code }) => {
        const room = rooms.get(code);
        if (!room || room.hostId !== socket.id) return;
        if (room.status === "finished") return;

        const promptIdx = pickNextPromptIdx(room);
        if (promptIdx === null) {
            io.to(code).emit("host:toast", "No prompts left. Add more to continue!");
            return;
        }

        room.round = { promptIdx, votes: new Map() };
        room.status = "round";
        room.usedPromptIdxs.add(promptIdx);
        io.to(code).emit("round:started", getRoomSafeSnapshot(room));
    });

    // Player votes
    socket.on("player:vote", ({ code, targetId }) => {
        const room = rooms.get(code);
        if (!room || room.status !== "round" || !room.round) return;
        if (!room.players.has(socket.id)) return;
        if (!room.players.has(targetId)) return;
        if (!room.players.get(socket.id).connected) return;

        room.round.votes.set(socket.id, targetId);

        // Live tally (anoymized)
        const tally = {};
        for (const tid of room.round.votes.values()) tally[tid] = (tally[tid] || 0) + 1;
        io.to(code).emit("round:voteProgress", { tally });

        // Close automatically when all connected players voted
        const connected = Array.from(room.players.values()).filter(p => p.connected).length;
        if (room.round.votes.size === connected) {
            for (const [, target] of room.round.votes.entries()) {
                const player = room.players.get(target);
                if (player) player.score += 1;
            }
            room.status = "reveal";

            const finalTally = {};
            for (const [, target] of room.round.votes.entries()) {
                finalTally[target] = (finalTally[target] || 0) + 1;
            }

            const winners = Array.from(room.players.values())
                .filter(p => p.score >= room.winningScore)
                .map(p => p.name);

            io.to(code).emit("round:results", {
                snapshot: getRoomSafeSnapshot(room),
                tally: finalTally,
                winners
            });

            if (winners.length) {
                room.status = "finished";
                io.to(code).emit("game:finished", { winners, snapshot: getRoomSafeSnapshot(room) });
            }
        }
    });

    // Host proceeds to next round
    socket.on("host:nextRound", ({ code }) => {
        const room = rooms.get(code);
        if (!room || room.hostId !== socket.id) return;
        if (room.status !== "reveal") return;
        room.round = null;
        room.status = "lobby";
        io.to(code).emit("room:update", getRoomSafeSnapshot(room));
    });

    // Disconnect Handling
    socket.on("disconnect", () => {
        for (const room of rooms.values()) {
            if (room.hostId === socket.id) {
                io.to(room.code).emit("host:disconnected");
                rooms.delete(room.code);
                continue;
            }
            if (room.players.has(socket.id)) {
                const p = room.players.get(socket.id);
                p.connected = false;
                io.to(room.code).emit("room:update", getRoomSafeSnapshot(room));
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`More Likely on http://localhost:${PORT}`);
});