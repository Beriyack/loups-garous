const { DURATIONS, DEV_DURATIONS } = require('../gameConfig');
let phases = null;

function init(phasesModule) {
    phases = phasesModule;
}

function createGame(roomId) {
    return {
        id: roomId,
        players: [],
        phase: 'waiting',
        durations: { ...DURATIONS }, // Copie pour éviter les modifications globales
        isPublic: false,
        votes: {},
        turn: 0,
        lovers: null,
        captainId: null,
        thief: null,
    };
}

function joinGame(game, playerData, socket, io) {
    if (game.deletionTimer) {
        clearTimeout(game.deletionTimer);
        game.deletionTimer = null;
    }

    socket.join(game.id);
    socket.roomId = game.id;

    const player = {
        id: socket.id,
        name: playerData.name,
        avatar: playerData.avatar,
        role: null,
        isBot: false,
        alive: true,
        potions: { life: true, death: true }
    };
    game.players.push(player);
    io.to(game.id).emit('updatePlayerList', game.players);
    socket.emit('roomJoined', game.id);
}

function rejoinGame(games, roomId, { newId, oldId, name }, socket, io) {
    const game = games[roomId];
    if (!game) return socket.emit('reconnectFailed');

    const player = game.players.find(p => p.id === oldId);
    if (player) {
        player.id = newId;
        player.disconnected = false;
        socket.join(roomId);
        socket.roomId = roomId;

        console.log(`Joueur ${player.name} reconnecté.`);

        if (game.phase === 'waiting') {
            socket.emit('roomJoined', roomId);
            io.to(roomId).emit('updatePlayerList', game.players);
        } else {
            socket.emit('gameStarted', game.players);
            socket.emit('phaseChange', {
                phase: game.phase,
                duration: 1000,
                msg: 'Reconnexion en cours...'
            });
        }
    } else {
        socket.emit('reconnectFailed');
    }
}

function restartGame(io, game) {
    if (!game) return;

    game.phase = 'waiting';
    game.votes = {};
    game.turn = 0;
    game.lovers = null;
    game.captainId = null;
    game.thief = null;
    game.pendingVictim = null;
    game.witchKillTarget = null;

    game.players.forEach(p => {
        if (!p.isBot) { // On ne réinitialise pas les bots, on les garde pour la prochaine partie
            p.role = null;
            p.alive = true;
            p.potions = { life: true, death: true };
            p.knowledge = null;
        }
    });

    io.to(game.id).emit('roomJoined', game.id);
    io.to(game.id).emit('updatePlayerList', game.players);
}

function handleDisconnect(games, socket, io) {
    const game = games[socket.roomId];
    if (!game) return;

    const player = game.players.find(p => p.id === socket.id);
    if (player) player.disconnected = true;

    if (game.phase === 'waiting') {
        setTimeout(() => {
            if (player && player.disconnected) {
                game.players = game.players.filter(p => p.id !== player.id);
                io.to(game.id).emit('updatePlayerList', game.players);

                if (game.players.filter(p => !p.isBot).length === 0) { // S'il ne reste que des bots
                    game.deletionTimer = setTimeout(() => {
                        if (games[game.id] && games[game.id].players.filter(p => !p.isBot).length === 0) {
                            delete games[game.id];
                            console.log(`Salle ${game.id} supprimée (inactivité).`);
                        }
                    }, 120000);
                }
            }
        }, 5000); // 5s de grâce
    }
}

function startGame(io, game, { playerCount, devMode, forceRole }, starterId) {
    if (game.players.length < 1) return;

    if (devMode) {
        game.durations = DEV_DURATIONS;
        console.log(`Partie ${game.id} lancée en mode DEV.`);
    } else {
        game.durations = DURATIONS;
    }

    game.votes = {};
    game.turn = 1;

    let botCount = 1;
    while (game.players.length < parseInt(playerCount)) {
        game.players.push({
            id: `bot-${Date.now()}-${botCount}`,
            name: `Bot ${botCount}`,
            avatar: null,
            role: null,
            isBot: true,
            alive: true,
            potions: { life: true, death: true }
        });
        botCount++;
    }

    const rolesToAssign = [];
    let hasThief = false;
    const numWolves = parseInt(playerCount) >= 12 ? 3 : 2;
    for (let i = 0; i < numWolves; i++) rolesToAssign.push('Loup-Garou');
    rolesToAssign.push('Sorcière', 'Voyante', 'Chasseur', 'Cupidon');
    if (parseInt(playerCount) >= 9) {
        rolesToAssign.push('Voleur');
        hasThief = true;
    }
    while (rolesToAssign.length < parseInt(playerCount)) {
        rolesToAssign.push('Villageois');
    }
    if (hasThief) {
        rolesToAssign.push('Villageois', 'Villageois');
    }

    const shuffledRoles = rolesToAssign.sort(() => 0.5 - Math.random());

    if (devMode && forceRole) {
        const roleIndex = shuffledRoles.indexOf(forceRole);
        if (roleIndex !== -1) {
            shuffledRoles.splice(roleIndex, 1);
            const me = game.players.find(p => p.id === starterId);
            if (me) me.role = forceRole;
        }
    }

    if (hasThief) {
        game.thief = {
            thiefId: null,
            extraCards: [shuffledRoles.pop(), shuffledRoles.pop()]
        };
    }

    game.players.forEach(p => {
        if (!p.role) {
            p.role = shuffledRoles.pop();
        }
        if (p.role === 'Voleur' && game.thief) {
            game.thief.thiefId = p.id;
        }
    });

    io.to(game.id).emit('gameStarted', game.players);
    phases.startPreparationPhase(io, game);
}

module.exports = { init, createGame, joinGame, rejoinGame, restartGame, handleDisconnect, startGame };