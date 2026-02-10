let bots = null;
let phases = null;

function init(callbacks) {
    bots = callbacks.bots;
    phases = callbacks.phases;
}

function handleVote(io, game, voterId, targetId) {
    const voter = game.players.find(p => p.id === voterId);
    if (!voter || !voter.alive) return;

    if (game.phase === 'night' && voter.role !== 'Loup-Garou') return;
    if (['witch', 'hunter_shot', 'captain_succession', 'cupid', 'seer', 'thief'].includes(game.phase)) return;

    if (game.votes[voterId] === targetId) return;

    game.votes[voterId] = targetId;

    const counts = {};
    if (game.phase === 'day' || game.phase === 'captain_election') {
        game.players.forEach(p => counts[p.id] = 0);
        for (const [vId, tId] of Object.entries(game.votes)) {
            if (counts[tId] !== undefined) {
                counts[tId]++;
            }
        }
        io.to(game.id).emit('updateVotes', counts);
    }

    if (game.phase === 'night') {
        const counts = {};
        game.players.forEach(p => counts[p.id] = 0);
        for (const [vId, tId] of Object.entries(game.votes)) {
            if (counts[tId] !== undefined) counts[tId]++;
        }
        const wolves = game.players.filter(p => p.role === 'Loup-Garou');
        wolves.forEach(w => io.to(w.id).emit('updateVotes', counts));
    }

    if (game.phase === 'day' && !voter.isBot) {
        setTimeout(() => bots.adjustBotVotes(io, game), 1500 + Math.random() * 2000);
    }

    const target = game.players.find(p => p.id === targetId);
    if (voter && target) {
        if (game.phase === 'day' || game.phase === 'captain_election') {
            io.to(game.id).emit('voteLog', { voterName: voter.name, targetName: target.name });
        } else if (game.phase === 'night') {
            const wolves = game.players.filter(p => p.role === 'Loup-Garou');
            wolves.forEach(w => {
                io.to(w.id).emit('info', `🐺 ${voter.name} cible ${target.name}`);
            });
        }
    }
}

function handleCupidSelect(io, game, targetIds) {
    if (game.phase === 'cupid' && targetIds.length === 2) {
        game.lovers = targetIds;
        clearTimeout(game.timer);
        phases.endCupidTurn(io, game);
    }
}

function handleSeerAction(io, game, seerId, targetId) {
    if (game.phase !== 'seer') return;
    const seer = game.players.find(p => p.id === seerId);
    const target = game.players.find(p => p.id === targetId);

    if (seer && seer.role === 'Voyante' && target) {
        io.to(seerId).emit('seerResult', {
            targetId: targetId,
            name: target.name,
            role: target.role
        });
    }
}

function handleThiefAction(io, game, thiefId, choiceIndex) {
    if (game.phase !== 'thief') return;
    const thiefPlayer = game.players.find(p => p.id === thiefId);
    if (!thiefPlayer || thiefPlayer.role !== 'Voleur') return;

    let chosenCard = null;
    let actualChoiceIndex = choiceIndex;

    if (game.thief.extraCards[0] === 'Loup-Garou' && game.thief.extraCards[1] === 'Loup-Garou') {
        if (actualChoiceIndex === -1) actualChoiceIndex = 0;
    }

    if (actualChoiceIndex === 0 || actualChoiceIndex === 1) {
        chosenCard = game.thief.extraCards[actualChoiceIndex];
    }

    if (chosenCard) {
        thiefPlayer.role = chosenCard;
        game.thief.extraCards[actualChoiceIndex] = 'Voleur';
        io.to(thiefId).emit('info', `Vous avez changé de rôle. Vous êtes maintenant : ${chosenCard}.`);
    } else {
        io.to(thiefId).emit('info', `Vous avez gardé votre rôle de Voleur.`);
    }

    io.to(game.id).emit('updatePlayerList', game.players);
    clearTimeout(game.timer);
    phases.endThiefPhase(io, game);
}

function handleWitchAction(io, game, socket, { action, targetId }) {
    if (game.phase !== 'witch') return;
    const witch = game.players.find(p => p.id === socket.id);
    if (!witch || witch.role !== 'Sorcière' || !witch.alive) return;

    if (action === 'save' && witch.potions.life && game.pendingVictim) {
        game.pendingVictim = null;
        witch.potions.life = false;
        io.to(witch.id).emit('info', "Vous avez utilisé votre potion de vie.");
    } else if (action === 'kill' && witch.potions.death && targetId) {
        game.witchKillTarget = targetId;
        witch.potions.death = false;
        io.to(witch.id).emit('info', "Vous avez utilisé votre potion de mort.");
    } else if (action === 'skip') {
        io.to(witch.id).emit('info', "Vous n'avez rien fait cette nuit.");
    }

    if (action === 'skip') {
        socket.emit('witchTurnEnd');
    }
}

function handleHunterShoot(game, hunterId, targetId) {
    if (game.phase !== 'hunter_shot') return;
    const hunter = game.players.find(p => p.id === hunterId);
    if (hunter && hunter.role === 'Chasseur') {
        clearTimeout(game.timer);
        if (game.hunterResolver) game.hunterResolver(targetId);
    }
}

function handleCaptainSuccession(game, targetId) {
    if (game.phase !== 'captain_succession') return;
    clearTimeout(game.timer);
    if (game.successionResolver) game.successionResolver(targetId);
}

module.exports = { init, handleVote, handleCupidSelect, handleSeerAction, handleThiefAction, handleWitchAction, handleHunterShoot, handleCaptainSuccession };