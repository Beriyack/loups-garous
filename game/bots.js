let handleVote = null;
let handleWitchAction = null;

function init(callbacks) {
    if (callbacks.handleVote) handleVote = callbacks.handleVote;
    if (callbacks.handleWitchAction) handleWitchAction = callbacks.handleWitchAction;
}

function botAction(io, game) {
    if (game.phase === 'finished') return;

    const bots = game.players.filter(p => p.isBot && p.alive);
    let phaseDuration = game.durations[game.phase.toUpperCase()] || 10000;

    bots.forEach(bot => {
        if (game.phase === 'day' && bot.role === 'Voyante' && bot.knowledge) {
            const knownWerewolfId = Object.keys(bot.knowledge).find(id =>
                bot.knowledge[id] === 'Loup-Garou' &&
                game.players.find(p => p.id === id && p.alive)
            );
            if (knownWerewolfId) {
                setTimeout(() => {
                    if (handleVote) handleVote(io, game, bot.id, knownWerewolfId);
                }, Math.random() * 5000 + 2000);
                return;
            }
        }

        if (game.phase === 'captain_election') {
            setTimeout(() => {
                const target = Math.random() > 0.5 ? bot : game.players[Math.floor(Math.random() * game.players.length)];
                if (handleVote) handleVote(io, game, bot.id, target.id);
            }, Math.random() * (phaseDuration * 0.5) + 1000);
            return;
        }

        if (game.phase !== 'day' && (game.phase !== 'night' || bot.role !== 'Loup-Garou')) return;

        const delay = Math.random() * (phaseDuration * 0.3) + (phaseDuration * 0.5);
        setTimeout(() => {
            if (game.phase === 'finished' || !bot.alive) return;

            let targets = game.players.filter(p => p.alive && p.id !== bot.id);
            if (game.lovers && game.lovers.includes(bot.id)) {
                targets = targets.filter(p => !game.lovers.includes(p.id));
            }
            if (bot.role === 'Loup-Garou') {
                targets = targets.filter(p => p.role !== 'Loup-Garou');
            }

            const humanVotes = Object.entries(game.votes)
                .filter(([voterId, _]) => !game.players.find(p => p.id === voterId)?.isBot)
                .map(([_, targetId]) => targetId);

            const validHumanTargets = targets.filter(t => humanVotes.includes(t.id));

            let finalTargetId = null;
            if (validHumanTargets.length > 0 && Math.random() < 0.8) {
                finalTargetId = validHumanTargets[Math.floor(Math.random() * validHumanTargets.length)].id;
            } else if (targets.length > 0) {
                finalTargetId = targets[Math.floor(Math.random() * targets.length)].id;
            }

            if (finalTargetId) {
                if (handleVote) handleVote(io, game, bot.id, finalTargetId);
            }
        }, delay);
    });

    if (game.phase === 'witch') {
        const witchBot = bots.find(b => b.role === 'Sorcière');
        if (witchBot && (witchBot.potions.life || witchBot.potions.death)) {
            setTimeout(() => {
                if (game.phase !== 'witch' || !witchBot.alive) return;

                if (game.pendingVictim && witchBot.potions.life && Math.random() > 0.5) {
                    if (handleWitchAction) handleWitchAction(io, game, { id: witchBot.id }, { action: 'save' });
                } else if (witchBot.potions.death && Math.random() > 0.7) {
                    let targets = game.players.filter(p => p.alive && p.id !== witchBot.id);
                    if (game.lovers && game.lovers.includes(witchBot.id)) {
                        targets = targets.filter(p => !game.lovers.includes(p.id));
                    }
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        if (handleWitchAction) handleWitchAction(io, game, { id: witchBot.id }, { action: 'kill', targetId: target.id });
                    } else {
                        if (handleWitchAction) handleWitchAction(io, game, { id: witchBot.id }, { action: 'skip' });
                    }
                } else {
                    if (handleWitchAction) handleWitchAction(io, game, { id: witchBot.id }, { action: 'skip' });
                }
            }, 2000);
        }
    }
}

module.exports = { init, botAction };