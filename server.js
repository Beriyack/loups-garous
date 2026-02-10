// --- Importation des modules nécessaires ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gameController = require('./game/controller');

const app = express();
const server = http.createServer(app);
const io = new Server(server); // On pourrait ajouter des options de reconnexion ici

app.use(express.static(path.join(__dirname, 'public')));

// --- Stockage des données ---
// Structure : { roomId: { players, phase, votes, id, turn, lovers, captainId, durations } }
const games = {};

io.on('connection', (socket) => {
    console.log('Un joueur connecté:', socket.id);

    socket.on('createPrivateGame', (playerData) => {
        const roomId = gameController.generateRoomId();
        games[roomId] = gameController.createGame(roomId);
        gameController.joinGame(games[roomId], playerData, socket, io);
    });

    socket.on('joinPrivateGame', ({ playerData, roomId }) => {
        const game = games[roomId];
        if (!game) return socket.emit('error', 'Partie introuvable.');
        if (game.phase !== 'waiting') return socket.emit('error', 'La partie a déjà commencé.');
        gameController.joinGame(game, playerData, socket, io);
    });

    socket.on('rejoinGame', ({ roomId, oldPlayerId, name }) => {
        gameController.rejoinGame(games, roomId, { newId: socket.id, oldId: oldPlayerId, name }, socket, io);
    });

    socket.on('restartGame', () => {
        const game = games[socket.roomId];
        if (game) gameController.restartGame(io, game);
    });

    socket.on('startGame', (options) => {
        const game = games[socket.roomId];
        if (game) gameController.startGame(io, game, options, socket.id);
    });

    socket.on('vote', (targetId) => {
        const game = games[socket.roomId];
        if (game) gameController.handleVote(io, game, socket.id, targetId);
    });

    socket.on('cupidSelect', (targetIds) => {
        const game = games[socket.roomId];
        if (game) gameController.handleCupidSelect(io, game, targetIds);
    });

    socket.on('seerAction', (targetId) => {
        const game = games[socket.roomId];
        if (game) gameController.handleSeerAction(io, game, socket.id, targetId);
    });

    socket.on('thiefChoice', (choiceIndex) => {
        const game = games[socket.roomId];
        if (game) gameController.handleThiefAction(io, game, socket.id, choiceIndex);
    });

    socket.on('witchAction', (data) => {
        const game = games[socket.roomId];
        if (game) gameController.handleWitchAction(io, game, socket, data);
    });

    socket.on('hunterShoot', async (targetId) => {
        const game = games[socket.roomId];
        if (game) gameController.handleHunterShoot(game, socket.id, targetId);
    });

    socket.on('captainSuccession', (targetId) => {
        const game = games[socket.roomId];
        if (game) gameController.handleCaptainSuccession(game, targetId);
    });

    // Permet au client de redemander la liste des joueurs pour forcer un rafraîchissement
    socket.on('requestPlayerList', () => {
        const game = games[socket.roomId];
        if (game) io.to(game.id).emit('updatePlayerList', game.players);
    });

    socket.on('disconnect', () => {
        gameController.handleDisconnect(games, socket, io);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
});