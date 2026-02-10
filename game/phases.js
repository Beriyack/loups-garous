// game/phases.js
let botAction = null;
let handleThiefAction = null;

function init(callbacks) {
    if (callbacks.botAction) botAction = callbacks.botAction;
    if (callbacks.handleThiefAction) handleThiefAction = callbacks.handleThiefAction;
}

function startPreparationPhase(io, game) {
    const thief = game.players.find(p => p.role === 'Voleur');
    if (thief) {
        startThiefPhase(io, game);
    } else {
        const cupid = game.players.find(p => p.role === 'Cupidon');
        if (cupid) {
            startCupidTurn(io, game, cupid);
        } else {
            startSeerPhase(io, game);
        }
    }
}

function startThiefPhase(io, game) {
    const thief = game.players.find(p => p.id === game.thief?.thiefId);
    if (!thief || !game.thief.extraCards) {
        return startCupidTurn(io, game);
    }
    game.phase = 'thief';
    io.to(game.id).emit('phaseChange', { phase: 'thief', duration: game.durations.THIEF, msg: '👤 Le Voleur se réveille...' });

    if (!thief.isBot) {
        io.to(thief.id).emit('thiefTurn', {
            currentRole: thief.role,
            extraCards: game.thief.extraCards
        });
    } else {
        setTimeout(() => {
            let choice = -1;
            if (game.thief.extraCards.includes('Loup-Garou')) choice = 0;
            else if (Math.random() > 0.5) choice = 0;
            if (handleThiefAction) handleThiefAction(io, game, thief.id, choice);
        }, game.durations.THIEF - 2000);
    }
    game.timer = setTimeout(() => endThiefPhase(io, game), game.durations.THIEF);
}

function endThiefPhase(io, game) {
    io.to(game.id).emit('info', '👤 Le Voleur s\'est rendormi.');
    const cupid = game.players.find(p => p.role === 'Cupidon');
    if (cupid) {
        startCupidTurn(io, game, cupid);
    } else {
        startSeerPhase(io, game);
    }
}

function startCupidTurn(io, game, cupid) {
    game.phase = 'cupid';
    io.to(game.id).emit('phaseChange', { phase: 'cupid', duration: game.durations.CUPID, msg: '💘 Cupidon se réveille pour former un couple...' });

    if (!cupid.isBot) {
        io.to(cupid.id).emit('cupidTurn', { duration: game.durations.CUPID });
    }
    game.timer = setTimeout(() => endCupidTurn(io, game), game.durations.CUPID);
}

function endCupidTurn(io, game) {
    if (!game.lovers || game.lovers.length < 2) {
        const availablePlayers = game.players.filter(p => p.alive);
        if (availablePlayers.length >= 2) {
            const p1Index = Math.floor(Math.random() * availablePlayers.length);
            const p1 = availablePlayers.splice(p1Index, 1)[0];
            const p2Index = Math.floor(Math.random() * availablePlayers.length);
            const p2 = availablePlayers.splice(p2Index, 1)[0];
            game.lovers = [p1.id, p2.id];
        }
    }

    if (game.lovers) {
        const cupid = game.players.find(p => p.role === 'Cupidon');
        const lover1 = game.players.find(p => p.id === game.lovers[0]);
        const lover2 = game.players.find(p => p.id === game.lovers[1]);

        io.to(game.id).emit('info', '💘 Cupidon a tiré ses flèches et s\'est rendormi.');
        io.to(lover1.id).emit('loversInfo', { partnerId: lover2.id, partnerName: lover2.name });
        io.to(lover2.id).emit('loversInfo', { partnerId: lover1.id, partnerName: lover1.name });
        if (cupid) io.to(cupid.id).emit('cupidResult', game.lovers);
    }

    startSeerPhase(io, game);
}

function startSeerPhase(io, game) {
    const seer = game.players.find(p => p.role === 'Voyante' && p.alive);
    if (!seer) {
        return startNightPhase(io, game);
    }

    game.phase = 'seer';
    io.to(game.id).emit('phaseChange', { phase: 'seer', duration: game.durations.SEER, msg: '👁️ La Voyante se réveille...' });

    if (!seer.isBot) {
        io.to(seer.id).emit('seerTurn', { duration: game.durations.SEER });
    } else {
        setTimeout(() => {
            if (!game.players.find(p => p.id === seer.id)?.alive) return;
            const targets = game.players.filter(p => p.id !== seer.id && p.alive);
            if (targets.length > 0) {
                const unknownTargets = targets.filter(t => !seer.knowledge || !seer.knowledge[t.id]);
                const target = unknownTargets.length > 0 ? unknownTargets[Math.floor(Math.random() * unknownTargets.length)] : targets[Math.floor(Math.random() * targets.length)];
                if (!seer.knowledge) seer.knowledge = {};
                seer.knowledge[target.id] = target.role;
            }
        }, 2000);
    }

    game.timer = setTimeout(() => endSeerPhase(io, game), game.durations.SEER);
}

function endSeerPhase(io, game) {
    startNightPhase(io, game);
}

function startNightPhase(io, game) {
    game.phase = 'night';
    game.votes = {};
    game.pendingVictim = null;

    io.to(game.id).emit('updateVotes', {});
    io.to(game.id).emit('phaseChange', { phase: 'night', duration: game.durations.NIGHT, msg: '🌙 La nuit tombe... Les Loups-Garous se réveillent.' });

    game.timer = setTimeout(() => endNightPhase(io, game), game.durations.NIGHT);
    if (botAction) botAction(io, game);
}

function endNightPhase(io, game) {
    const counts = {};
    Object.values(game.votes).forEach(tid => counts[tid] = (counts[tid] || 0) + 1);

    let maxVotes = 0;
    let candidates = [];
    for (const [pid, count] of Object.entries(counts)) {
        if (count > maxVotes) {
            maxVotes = count;
            candidates = [pid];
        } else if (count === maxVotes) {
            candidates.push(pid);
        }
    }

    game.pendingVictim = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    startWitchPhase(io, game);
}

function startWitchPhase(io, game) {
    game.phase = 'witch';
    const witch = game.players.find(p => p.role === 'Sorcière' && p.alive);

    if (!witch || (!witch.potions.life && !witch.potions.death)) {
        return endWitchPhase(io, game);
    }

    io.to(game.id).emit('phaseChange', { phase: 'witch', duration: game.durations.WITCH, msg: '🧙‍♀️ La Sorcière se réveille...' });

    if (!witch.isBot) {
        const victimName = game.pendingVictim ? game.players.find(p => p.id === game.pendingVictim)?.name : null;
        io.to(witch.id).emit('witchTurn', {
            victimId: game.pendingVictim,
            victimName: victimName,
            potions: witch.potions,
            duration: game.durations.WITCH
        });
    } else {
        if (botAction) botAction(io, game);
    }

    game.timer = setTimeout(() => endWitchPhase(io, game), game.durations.WITCH);
}

async function endWitchPhase(io, game) {
    const deadIds = [];
    if (game.pendingVictim) deadIds.push(game.pendingVictim);
    if (game.witchKillTarget) deadIds.push(game.witchKillTarget);

    const uniqueDead = [...new Set(deadIds)];

    if (uniqueDead.length > 0) {
        const names = uniqueDead.map(id => game.players.find(p => p.id === id)?.name).join(' et ');
        const gameOver = await processDeaths(io, game, uniqueDead, `🌅 Le village découvre que ${names} est mort(e) cette nuit.`);
        if (gameOver) return;
    } else {
        io.to(game.id).emit('info', `🌅 Le village se réveille. Personne n'est mort cette nuit !`);
    }

    game.witchKillTarget = null;
    game.pendingVictim = null;

    if (checkWinCondition(io, game)) return;
    startDayPhase(io, game);
}

async function processDeaths(io, game, initialDeadIds, initialReason) {
    const deathQueue = [...new Set(initialDeadIds)].map(id => ({ id, reason: initialReason }));
    const processedInThisChain = new Set();

    while (deathQueue.length > 0) {
        const { id: victimId, reason } = deathQueue.shift();

        if (processedInThisChain.has(victimId)) continue;

        const victim = game.players.find(p => p.id === victimId);
        if (!victim || !victim.alive) continue;

        victim.alive = false;
        processedInThisChain.add(victimId);
        io.to(game.id).emit('info', `${reason} ${victim.name} est mort(e) ! Son rôle était : ${victim.role}.`);
        io.to(game.id).emit('playerKilled', { id: victimId, role: victim.role });

        if (checkWinCondition(io, game)) return true;

        if (game.lovers?.includes(victimId)) {
            io.to(game.id).emit('revealLovers', game.lovers);
            const otherLoverId = game.lovers.find(id => id !== victimId);
            if (otherLoverId && !processedInThisChain.has(otherLoverId)) {
                deathQueue.push({ id: otherLoverId, reason: '💔 Mort de chagrin,' });
            }
        }

        if (game.captainId === victimId) {
            game.phase = 'captain_succession';
            io.to(game.id).emit('phaseChange', { phase: 'captain_succession', duration: game.durations.CAPTAIN_SUCCESSION, msg: `👑 Le Capitaine ${victim.name} est mort ! Il doit désigner son successeur.` });

            if (!victim.isBot) {
                io.to(victim.id).emit('captainSuccessionTurn', { duration: game.durations.CAPTAIN_SUCCESSION });
            }

            const successorId = await new Promise(resolve => {
                game.successionResolver = resolve;
                if (victim.isBot) {
                    const candidates = game.players.filter(p => p.alive && p.id !== victimId);
                    const chosen = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)].id : null;
                    setTimeout(() => resolve(chosen), game.durations.CAPTAIN_SUCCESSION - 1000);
                } else {
                    game.timer = setTimeout(() => {
                        const candidates = game.players.filter(p => p.alive && p.id !== victimId);
                        const randomSuccessor = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)].id : null;
                        if (randomSuccessor) {
                            const successorName = game.players.find(p => p.id === randomSuccessor)?.name;
                            io.to(game.id).emit('info', `⌛ Temps écoulé ! Le hasard a désigné ${successorName} comme nouveau Capitaine.`);
                        }
                        resolve(randomSuccessor);
                    }, game.durations.CAPTAIN_SUCCESSION);
                }
            });

            if (successorId) {
                game.captainId = successorId;
                const newCaptain = game.players.find(p => p.id === successorId);
                if (newCaptain && newCaptain.alive) {
                    io.to(game.id).emit('info', `👑 ${newCaptain.name} est le nouveau Capitaine !`);
                }
                io.to(game.id).emit('captainChange', successorId);
            } else {
                io.to(game.id).emit('info', `👑 Le Capitaine n'a désigné personne. Il n'y a plus de Capitaine.`);
                game.captainId = null;
                io.to(game.id).emit('captainChange', null);
            }
        }

        if (victim.role === 'Chasseur') {
            game.phase = 'hunter_shot';
            io.to(game.id).emit('phaseChange', { phase: 'hunter_shot', duration: game.durations.HUNTER, msg: `🏹 Le Chasseur ${victim.name} a un dernier tir !` });

            if (!victim.isBot) {
                io.to(victim.id).emit('hunterTurn', { duration: game.durations.HUNTER });
            }

            const shotVictimId = await new Promise(resolve => {
                game.hunterResolver = resolve;
                if (victim.isBot) {
                    const candidates = game.players.filter(p => p.alive && p.id !== victimId);
                    const chosen = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)].id : null;
                    setTimeout(() => resolve(chosen), game.durations.HUNTER - 1000);
                } else {
                    game.timer = setTimeout(() => resolve(null), game.durations.HUNTER);
                }
            });

            if (shotVictimId) {
                deathQueue.push({ id: shotVictimId, reason: '🏹 Touché par le Chasseur,' });
            }
        }
    }
    return false;
}

function startDayPhase(io, game) {
    if (game.turn === 1) {
        startCaptainElection(io, game);
    } else {
        game.phase = 'day';
        game.votes = {};
        io.to(game.id).emit('updateVotes', {});
        io.to(game.id).emit('phaseChange', { phase: 'day', duration: game.durations.DAY, msg: '☀️ C\'est le jour. Débattez et votez !' });

        game.timer = setTimeout(() => endDayPhase(io, game), game.durations.DAY);
        if (botAction) botAction(io, game);
    }
}

function startCaptainElection(io, game) {
    game.phase = 'captain_election';
    game.votes = {};
    io.to(game.id).emit('updateVotes', {});
    io.to(game.id).emit('phaseChange', { phase: 'captain_election', duration: game.durations.CAPTAIN_ELECTION, msg: '👑 Élection du Capitaine ! Votez pour un joueur.' });

    game.timer = setTimeout(() => endCaptainElection(io, game), game.durations.CAPTAIN_ELECTION);
    if (botAction) botAction(io, game);
}

function endCaptainElection(io, game) {
    const counts = {};
    Object.values(game.votes).forEach(tid => counts[tid] = (counts[tid] || 0) + 1);

    let maxVotes = 0;
    let candidates = [];
    for (const [pid, count] of Object.entries(counts)) {
        if (count > maxVotes) {
            maxVotes = count;
            candidates = [pid];
        } else if (count === maxVotes) {
            candidates.push(pid);
        }
    }

    if (candidates.length > 0) {
        const electedId = candidates[Math.floor(Math.random() * candidates.length)];
        game.captainId = electedId;
        const captain = game.players.find(p => p.id === electedId);
        io.to(game.id).emit('info', `👑 ${captain.name} a été élu(e) Capitaine ! Son vote compte double.`);
        io.to(game.id).emit('captainChange', electedId);
    } else {
        io.to(game.id).emit('info', `👑 Personne n'a été élu. Il n'y a pas de Capitaine pour le moment.`);
    }

    game.phase = 'day';
    game.votes = {};
    io.to(game.id).emit('updateVotes', {});
    io.to(game.id).emit('phaseChange', { phase: 'day', duration: game.durations.DAY, msg: '☀️ Le premier jour de vote commence !' });

    game.timer = setTimeout(() => endDayPhase(io, game), game.durations.DAY);
    if (botAction) botAction(io, game);
}

async function endDayPhase(io, game) {
    if (game.phase === 'finished') return;

    const counts = {};
    game.players.forEach(p => counts[p.id] = 0);
    for (const [voterId, targetId] of Object.entries(game.votes)) {
        if (counts[targetId] !== undefined) {
            counts[targetId]++;
        }
    }

    let maxVotes = 0;
    let candidates = [];
    for (const [pid, count] of Object.entries(counts)) {
        if (count > maxVotes) {
            maxVotes = count;
            candidates = [pid];
        } else if (count > 0 && count === maxVotes) {
            candidates.push(pid);
        }
    }

    let victimId = null;
    if (candidates.length === 1) {
        victimId = candidates[0];
    } else if (candidates.length > 1) {
        const captainVote = game.votes[game.captainId];
        if (captainVote && candidates.includes(captainVote)) {
            victimId = captainVote;
        } else {
            victimId = null;
        }
    } else {
        victimId = candidates[Math.floor(Math.random() * candidates.length)];
    }

    if (victimId) {
        const victim = game.players.find(p => p.id === victimId);
        if (victim && victim.alive) {
            const gameOver = await processDeaths(io, game, [victimId], `☠️ Le village a éliminé`);
            if (gameOver) return;
        }
    } else {
        io.to(game.id).emit('info', "🕊️ Personne n'a été éliminé (égalité ou aucun vote).");
    }

    if (checkWinCondition(io, game)) return;

    game.turn++;
    startSeerPhase(io, game);
}

function checkWinCondition(io, game) {
    const alivePlayers = game.players.filter(p => p.alive);
    const wolves = alivePlayers.filter(p => p.role === 'Loup-Garou');
    const villagers = alivePlayers.filter(p => p.role !== 'Loup-Garou');

    let winner = null;

    if (game.lovers) {
        const lover1 = game.players.find(p => p.id === game.lovers[0]);
        const lover2 = game.players.find(p => p.id === game.lovers[1]);
        if (alivePlayers.length === 2 && lover1.alive && lover2.alive) {
            winner = `💘 Les amoureux ${lover1.name} et ${lover2.name} ont gagné !`;
        }
    }

    if (!winner) {
        if (wolves.length === 0) {
            winner = 'Les Villageois ont gagné !';
        } else if (wolves.length >= villagers.length) {
            winner = 'Les Loups-Garous ont gagné !';
        }
    }

    if (winner) {
        game.phase = 'finished';
        clearTimeout(game.timer);
        io.to(game.id).emit('gameOver', { message: winner, players: game.players, thiefCards: game.thief ? game.thief.extraCards : null, lovers: game.lovers });
        return true;
    }
    return false;
}

module.exports = {
    init,
    startPreparationPhase,
    startThiefPhase,
    endThiefPhase,
    startCupidTurn,
    endCupidTurn,
    startSeerPhase,
    endSeerPhase,
    startNightPhase,
    endNightPhase,
    startWitchPhase,
    endWitchPhase,
    processDeaths,
    startDayPhase,
    startCaptainElection,
    endCaptainElection,
    endDayPhase,
    checkWinCondition
};