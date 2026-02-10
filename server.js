// --- Importation des modules nécessaires ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { ALL_ROLES, DURATIONS, DEV_DURATIONS } = require('./gameConfig');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- Stockage des données ---
// Structure : { roomId: { players, phase, votes, id, turn, lovers, captainId, durations } }
const games = {};

// --- Fonctions Utilitaires ---

// Génère un ID de salle aléatoire et court (ex: "X7K9P")
function generateRoomId() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Gestion de l'Intelligence Artificielle (Bots)
function botAction(game) {
    if (game.phase === 'finished') return;

    const bots = game.players.filter(p => p.isBot && p.alive);
    
    // Déterminer la durée de la phase actuelle pour le délai
    let phaseDuration = 10000; // Valeur par défaut
    if (game.phase === 'day') phaseDuration = game.durations.DAY;
    else if (game.phase === 'night') phaseDuration = game.durations.NIGHT;
    else if (game.phase === 'captain_election') phaseDuration = game.durations.CAPTAIN_ELECTION;
    
    bots.forEach(bot => {
        // --- Logique Spéciale Voyante (Jour) ---
        if (game.phase === 'day' && bot.role === 'Voyante' && bot.knowledge) {
            // Chercher un loup-garou connu et vivant
            const knownWerewolfId = Object.keys(bot.knowledge).find(id => 
                bot.knowledge[id] === 'Loup-Garou' && 
                game.players.find(p => p.id === id && p.alive)
            );
            
            if (knownWerewolfId) {
                // Vote prioritaire contre le loup identifié
                setTimeout(() => handleVote(game, bot.id, knownWerewolfId), Math.random() * 5000 + 2000);
                return; // On sort de la boucle pour ce bot, il a fait son choix
            }
        }

        // --- Logique Spéciale Élection Capitaine ---
        if (game.phase === 'captain_election') {
            setTimeout(() => {
                // Vote pour soi-même (50%) ou un joueur aléatoire
                const target = Math.random() > 0.5 ? bot : game.players[Math.floor(Math.random() * game.players.length)];
                handleVote(game, bot.id, target.id);
            }, Math.random() * (phaseDuration * 0.5) + 1000);
            return;
        }

        // Les bots ne votent que le jour ou la nuit (si loup)
        if (game.phase !== 'day' && game.phase !== 'night') return;
        if (game.phase === 'night' && bot.role !== 'Loup-Garou') return;

        // Délai : Les bots attendent entre 50% et 80% du temps imparti
        // Cela permet aux joueurs humains de voter en premier
        const delay = Math.random() * (phaseDuration * 0.3) + (phaseDuration * 0.5);

        setTimeout(() => {
            if (game.phase === 'finished' || !bot.alive) return;

            let targets = game.players.filter(p => p.alive && p.id !== bot.id);

            // 1. Protection du Couple (Priorité absolue)
            if (game.lovers && game.lovers.includes(bot.id)) {
                targets = targets.filter(p => !game.lovers.includes(p.id));
            }

            // 2. Protection de la Meute (Si Loup)
            if (bot.role === 'Loup-Garou') {
                targets = targets.filter(p => p.role !== 'Loup-Garou');
            }

            // 3. Suivre les humains (Influence sociale)
            const humanVotes = [];
            for (const [voterId, targetId] of Object.entries(game.votes)) {
                const voter = game.players.find(p => p.id === voterId);
                if (voter && !voter.isBot) {
                    humanVotes.push(targetId);
                }
            }

            // Filtrer les cibles qui ont reçu des votes humains
            const validHumanTargets = targets.filter(t => humanVotes.includes(t.id));
            
            let finalTargetId = null;
            // 80% de chance de suivre un vote humain existant si possible
            if (validHumanTargets.length > 0 && Math.random() < 0.8) {
                finalTargetId = validHumanTargets[Math.floor(Math.random() * validHumanTargets.length)].id;
            } else if (targets.length > 0) {
                finalTargetId = targets[Math.floor(Math.random() * targets.length)].id;
            }

            if (finalTargetId) {
                handleVote(game, bot.id, finalTargetId);
            }
        }, delay);
    });

    // Logique Bot Sorcière (Sauve souvent, tue rarement)
    if (game.phase === 'witch') {
        const witchBot = bots.find(b => b.role === 'Sorcière');
        if (witchBot && (witchBot.potions.life || witchBot.potions.death)) {
            setTimeout(() => {
                if (game.phase !== 'witch' || !witchBot.alive) return;

                // 50% de chance de sauver si potion dispo
                if (game.pendingVictim && witchBot.potions.life && Math.random() > 0.5) {
                    handleWitchAction(game, witchBot.id, 'save');
                } 
                // Sinon 30% de chance de tuer quelqu'un si potion dispo
                else if (witchBot.potions.death && Math.random() > 0.7) {
                    let targets = game.players.filter(p => p.alive && p.id !== witchBot.id);
                    // Ne pas tuer son amoureux
                    if (game.lovers && game.lovers.includes(witchBot.id)) {
                        targets = targets.filter(p => !game.lovers.includes(p.id));
                    }
                    
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        handleWitchAction(game, witchBot.id, 'kill', target.id);
                    } else {
                        handleWitchAction(game, witchBot.id, 'skip');
                    }
                } else {
                    handleWitchAction(game, witchBot.id, 'skip');
                }
            }, 2000);
        }
    }
}

// --- Phases de Jeu : Nuit (Voyante) ---

function startSeerPhase(game) {
    // Vérifier s'il y a une voyante vivante
    const seer = game.players.find(p => p.role === 'Voyante' && p.alive);
    
    // S'il n'y a pas de voyante, on passe directement à la phase suivante (Loups)
    if (!seer) {
        return startNightPhase(game);
    }

    game.phase = 'seer';
    io.to(game.id).emit('phaseChange', { phase: 'seer', duration: game.durations.SEER, msg: '👁️ La Voyante se réveille...' });

    if (!seer.isBot) {
        io.to(seer.id).emit('seerTurn', { duration: game.durations.SEER });
    } else {
        // Logique Bot Voyante : Mémoriser un rôle
        setTimeout(() => {
            if (!game.players.find(p => p.id === seer.id)?.alive) return;
            const targets = game.players.filter(p => p.id !== seer.id && p.alive);
            if (targets.length > 0) {
                // Choisir une cible non connue de préférence
                const unknownTargets = targets.filter(t => !seer.knowledge || !seer.knowledge[t.id]);
                const target = unknownTargets.length > 0 ? unknownTargets[Math.floor(Math.random() * unknownTargets.length)] : targets[Math.floor(Math.random() * targets.length)];
                
                if (!seer.knowledge) seer.knowledge = {};
                seer.knowledge[target.id] = target.role;
            }
        }, 2000);
    }
    
    game.timer = setTimeout(() => endSeerPhase(game), game.durations.SEER);
}

function handleSeerAction(game, seerId, targetId) {
    const seer = game.players.find(p => p.id === seerId);
    const target = game.players.find(p => p.id === targetId);
    
    if (seer && seer.role === 'Voyante' && target) {
        io.to(seerId).emit('seerResult', { 
            targetId: targetId, // Ajout de l'ID pour la mémoire du client
            name: target.name, 
            role: target.role 
        });
    }
}

function endSeerPhase(game) {
    startNightPhase(game); // Après la voyante, c'est au tour des loups
}

// --- Phases de Jeu : Nuit (Loups-Garous) ---

function startNightPhase(game) {
    game.phase = 'night';
    game.votes = {};
    game.pendingVictim = null; // Réinitialiser la victime des loups
    
    io.to(game.id).emit('updateVotes', {});
    io.to(game.id).emit('phaseChange', { phase: 'night', duration: game.durations.NIGHT, msg: '🌙 La nuit tombe... Les Loups-Garous se réveillent.' });

    game.timer = setTimeout(() => endNightPhase(game), game.durations.NIGHT);
    botAction(game);
}

function endNightPhase(game) {
    // Calculer la victime des loups
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

    // En cas d'égalité, choix aléatoire, sinon null
    game.pendingVictim = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    
    startWitchPhase(game);
}
// --- Phases de Jeu : Nuit (Sorcière) ---

function startWitchPhase(game) {
    game.phase = 'witch';
    // Vérifier si une sorcière est en vie
    const witch = game.players.find(p => p.role === 'Sorcière' && p.alive);
    
    // Si pas de sorcière ou plus de potions, on passe directement
    if (!witch || (!witch.potions.life && !witch.potions.death)) {
        return endWitchPhase(game);
    }

    if (!witch.isBot) {
        // IMPORTANT : Envoyer le changement de phase D'ABORD pour réinitialiser l'interface
        io.to(game.id).emit('phaseChange', { phase: 'witch', duration: game.durations.WITCH, msg: '🧙‍♀️ La Sorcière se réveille...' });
        
        // Envoyer les infos uniquement à la sorcière
        const victimName = game.pendingVictim ? game.players.find(p => p.id === game.pendingVictim)?.name : null;
        io.to(witch.id).emit('witchTurn', { 
            victimId: game.pendingVictim, 
            victimName: victimName,
            potions: witch.potions,
            duration: game.durations.WITCH
        });
    } else {
        // Si bot, on simule une attente courte ou on passe
        io.to(game.id).emit('phaseChange', { phase: 'witch', duration: game.durations.WITCH, msg: '🧙‍♀️ La Sorcière se réveille...' });
        botAction(game); // Le bot sorcière agit ici
    }

    game.timer = setTimeout(() => endWitchPhase(game), game.durations.WITCH);
}

async function endWitchPhase(game) {
    // Résolution des morts (Loups + Sorcière)
    const deadIds = [];
    if (game.pendingVictim) deadIds.push(game.pendingVictim);
    if (game.witchKillTarget) deadIds.push(game.witchKillTarget);

    const uniqueDead = [...new Set(deadIds)];
    
    if (uniqueDead.length > 0) {
        const names = uniqueDead.map(id => game.players.find(p => p.id === id)?.name).join(' et ');
        // On utilise processDeaths pour gérer correctement les réactions en chaîne (Amoureux, Chasseur...)
        const gameOver = await processDeaths(game, uniqueDead, `🌅 Le village découvre que ${names} est mort(e) cette nuit.`);
        if (gameOver) return;
    } else {
        io.to(game.id).emit('info', `🌅 Le village se réveille. Personne n'est mort cette nuit !`);
    }

    game.witchKillTarget = null; // Reset
    game.pendingVictim = null;

    if (checkWinCondition(game)) return;
    startDayPhase(game);
}
// --- Gestion des Morts et Réactions en Chaîne ---

async function processDeaths(game, initialDeadIds, initialReason) {
    const deathQueue = [...new Set(initialDeadIds)].map(id => ({ id, reason: initialReason }));
    const processedInThisChain = new Set();

    while (deathQueue.length > 0) {
        const { id: victimId, reason } = deathQueue.shift();

        if (processedInThisChain.has(victimId)) continue;

        const victim = game.players.find(p => p.id === victimId);
        if (!victim || !victim.alive) continue;

        // Mark as dead
        victim.alive = false;
        processedInThisChain.add(victimId);
        io.to(game.id).emit('info', `${reason} ${victim.name} est mort(e) ! Son rôle était : ${victim.role}.`);
        io.to(game.id).emit('playerKilled', { id: victimId, role: victim.role });

        if (checkWinCondition(game)) return true; // Game over, stop processing

        // --- Réactions en Chaîne ---

        // 1. Mort d'un Amoureux
        if (game.lovers?.includes(victimId)) {
            // Révéler les amoureux à tout le monde immédiatement
            io.to(game.id).emit('revealLovers', game.lovers);

            const otherLoverId = game.lovers.find(id => id !== victimId);
            if (otherLoverId && !processedInThisChain.has(otherLoverId)) {
                deathQueue.push({ id: otherLoverId, reason: '💔 Mort de chagrin,' });
            }
        }

        // 2. Mort du Capitaine (Succession)
        if (game.captainId === victimId) {
            game.phase = 'captain_succession';
            io.to(game.id).emit('phaseChange', { phase: 'captain_succession', duration: game.durations.CAPTAIN_SUCCESSION, msg: `👑 Le Capitaine ${victim.name} est mort ! Il doit désigner son successeur.` });
            
            if (!victim.isBot) {
                io.to(victim.id).emit('captainSuccessionTurn', { duration: game.durations.CAPTAIN_SUCCESSION });
            }

            const successorId = await new Promise(resolve => {
                game.successionResolver = resolve;
                
                if (victim.isBot) {
                    // Logique Bot : choisit un successeur au hasard parmi les vivants
                    const candidates = game.players.filter(p => p.alive && p.id !== victimId);
                    const chosen = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)].id : null;
                    // Le bot attend la fin du timer pour simuler l'hésitation, ou on pourrait mettre un délai aléatoire long.
                    // Pour simplifier et garder le suspense, on laisse le timer global gérer la fin de phase.
                    // Mais comme on utilise une Promise ici qui bloque processDeaths, il faut quand même résoudre.
                    // Pour ne pas bloquer le serveur, on va utiliser un setTimeout proche de la durée max.
                    setTimeout(() => resolve(chosen), game.durations.CAPTAIN_SUCCESSION - 1000);
                } else {
                    game.timer = setTimeout(() => {
                        // Si le temps est écoulé, on choisit un successeur au hasard
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
                } else {
                    // Si le successeur est déjà mort (cas rare de double mort simultanée), on relance une succession ou on annule
                    // Pour simplifier ici, on considère que le titre est perdu si le successeur meurt en même temps
                }
                io.to(game.id).emit('captainChange', successorId);
            } else {
                 io.to(game.id).emit('info', `👑 Le Capitaine n'a désigné personne. Il n'y a plus de Capitaine.`);
                 game.captainId = null;
                 io.to(game.id).emit('captainChange', null);
            }
        }

        // 3. Mort du Chasseur (Tir)
        if (victim.role === 'Chasseur') {
            game.phase = 'hunter_shot';
            io.to(game.id).emit('phaseChange', { phase: 'hunter_shot', duration: game.durations.HUNTER, msg: `🏹 Le Chasseur ${victim.name} a un dernier tir !` });
            
            if (!victim.isBot) {
                io.to(victim.id).emit('hunterTurn', { duration: game.durations.HUNTER });
            }

            const shotVictimId = await new Promise(resolve => {
                game.hunterResolver = resolve;
                
                if (victim.isBot) {
                    // Logique Bot : tire sur un joueur vivant au hasard
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
    return false; // La partie continue
}

// --- Phases de Jeu : Jour ---

function startDayPhase(game) {
    // Si c'est le premier jour, on élit le capitaine
    if (game.turn === 1) {
        startCaptainElection(game);
    } else {
        game.phase = 'day';
        game.votes = {};
        io.to(game.id).emit('updateVotes', {});
        io.to(game.id).emit('phaseChange', { phase: 'day', duration: game.durations.DAY, msg: '☀️ C\'est le jour. Débattez et votez !' });
        
        game.timer = setTimeout(() => endDayPhase(game), game.durations.DAY);
        botAction(game);
    }
}

function startCaptainElection(game) {
    game.phase = 'captain_election';
    game.votes = {};
    io.to(game.id).emit('updateVotes', {});
    io.to(game.id).emit('phaseChange', { phase: 'captain_election', duration: game.durations.CAPTAIN_ELECTION, msg: '👑 Élection du Capitaine ! Votez pour un joueur.' });

    game.timer = setTimeout(() => endCaptainElection(game), game.durations.CAPTAIN_ELECTION);
    botAction(game); // Les bots doivent voter !
}

function endCaptainElection(game) {
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

    // Après l'élection, on passe à la phase de vote normale du premier jour
    game.phase = 'day';
    game.votes = {};
    io.to(game.id).emit('updateVotes', {});
    io.to(game.id).emit('phaseChange', { phase: 'day', duration: game.durations.DAY, msg: '☀️ Le premier jour de vote commence !' });
    
    game.timer = setTimeout(() => endDayPhase(game), game.durations.DAY);
    botAction(game);
}

async function endDayPhase(game) {
    if (game.phase === 'finished') return;

    // 1. Calculer les votes (sans le vote double du capitaine pour l'instant)
    const counts = {};
    game.players.forEach(p => counts[p.id] = 0);
    for (const [voterId, targetId] of Object.entries(game.votes)) {
        if (counts[targetId] !== undefined) {
            counts[targetId]++;
        }
    }

    // 2. Trouver les joueurs avec le plus de votes
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

    // 3. Gestion de l'égalité et du vote du Capitaine
    let victimId = null;
    if (candidates.length === 1) {
        // Un seul joueur a le plus de votes, il est éliminé
        victimId = candidates[0];
    } else if (candidates.length > 1) {
        // Égalité : le vote du capitaine tranche
        const captainVote = game.votes[game.captainId];
        if (captainVote && candidates.includes(captainVote)) {
            victimId = captainVote; // Le vote du capitaine brise l'égalité
        } else {
            // Le capitaine n'a pas voté pour l'un des joueurs à égalité, ou il n'y a pas de capitaine
            // Personne ne meurt dans ce cas (règle officielle pour éviter le tirage au sort)
            victimId = null;
        }
    } else {
        victimId = candidates[Math.floor(Math.random() * candidates.length)];
    }

    if (victimId) {
        const victim = game.players.find(p => p.id === victimId);
        if (victim && victim.alive) {
            const reason = candidates.length > 1 ? " (vote du Capitaine)" : "";
            const gameOver = await processDeaths(game, [victimId], `☠️ Le village a éliminé`);
            if (gameOver) return;
        }
    } else {
        io.to(game.id).emit('info', "🕊️ Personne n'a été éliminé (égalité ou aucun vote).");
    }

    // 3. Vérifier la victoire ou relancer un jour
    if (checkWinCondition(game)) return;

    game.turn++; // On passe au jour suivant (empêche la réélection du maire)
    // On relance le cycle de nuit (Voyante -> Loups -> Sorcière)
    startSeerPhase(game);
}

// --- Conditions de Victoire ---

function checkWinCondition(game) {
    const alivePlayers = game.players.filter(p => p.alive);
    const wolves = alivePlayers.filter(p => p.role === 'Loup-Garou');
    const villagers = alivePlayers.filter(p => p.role !== 'Loup-Garou');

    const wolvesCount = wolves.length;
    const villagersCount = villagers.length;
    const captain = alivePlayers.find(p => p.id === game.captainId);
    const captainIsWolf = captain && captain.role === 'Loup-Garou';

    let winner = null;

    // 1. Victoire des Amoureux (Seuls survivants)
    if (game.lovers) {
        const lover1 = game.players.find(p => p.id === game.lovers[0]);
        const lover2 = game.players.find(p => p.id === game.lovers[1]);
        // Si les amoureux sont les seuls survivants
        if (alivePlayers.length === 2 && lover1.alive && lover2.alive) {
            winner = `💘 Les amoureux ${lover1.name} et ${lover2.name} ont gagné !`;
        }
    }

    // 2. Victoire Classique
    if (!winner) {
        if (wolvesCount === 0) {
            winner = 'Les Villageois ont gagné !';
        } else if (wolvesCount > villagersCount) {
            winner = 'Les Loups-Garous ont gagné !';
        } else if (wolvesCount === villagersCount && captainIsWolf) {
            // Les loups gagnent à égalité SEULEMENT s'ils ont le Capitaine (pour trancher)
            winner = 'Les Loups-Garous ont gagné !';
        }
    }

    if (winner) {
        game.phase = 'finished';
        clearTimeout(game.timer); // Arrêter le timer
        io.to(game.id).emit('gameOver', { message: winner, players: game.players, thiefCards: game.thief ? game.thief.extraCards : null, lovers: game.lovers });
        return true;
    }
    return false;
}

// --- Logique de réaction des Bots aux votes humains ---
function adjustBotVotes(game) {
    if (game.phase !== 'day') return;

    const bots = game.players.filter(p => p.isBot && p.alive);
    const humanVotes = [];

    // Récupérer les cibles votées par les humains
    for (const [voterId, targetId] of Object.entries(game.votes)) {
        const voter = game.players.find(p => p.id === voterId);
        if (voter && !voter.isBot) {
            humanVotes.push(targetId);
        }
    }

    if (humanVotes.length === 0) return;

    bots.forEach(bot => {
        // 40% de chance de changer son vote pour suivre un humain
        if (Math.random() < 0.4) {
            // Choisir une cible au hasard parmi celles visées par les humains (pondération naturelle)
            const targetId = humanVotes[Math.floor(Math.random() * humanVotes.length)];
            
            // Vérifications de sécurité (ne pas voter contre soi, son amoureux ou un loup ami)
            let valid = true;
            if (targetId === bot.id) valid = false;
            if (game.lovers?.includes(bot.id) && game.lovers?.includes(targetId)) valid = false;
            if (bot.role === 'Loup-Garou') {
                const target = game.players.find(p => p.id === targetId);
                if (target && target.role === 'Loup-Garou') valid = false;
            }

            // Si le vote est valide et différent, on change
            if (valid && game.votes[bot.id] !== targetId) {
                handleVote(game, bot.id, targetId);
            }
        }
    });
}

// --- Gestion des Actions Joueurs ---

function handleVote(game, voterId, targetId) {
    // Vérification : Phase correcte ?
    const voter = game.players.find(p => p.id === voterId);
    if (!voter || !voter.alive) return;

    if (game.phase === 'night' && voter.role !== 'Loup-Garou') return;
    if (['witch', 'hunter_shot', 'captain_succession', 'cupid', 'seer', 'thief'].includes(game.phase)) return;

    // Anti-Spam : Si le vote est identique, on ignore
    if (game.votes[voterId] === targetId) return;

    // Enregistrer le vote (Un joueur ne peut avoir qu'un seul vote actif)
    game.votes[voterId] = targetId;
    
    // Recalculer les totaux
    const counts = {};
    // On n'affiche les comptes que le jour ou pendant l'élection
    if (game.phase === 'day' || game.phase === 'captain_election') {
        game.players.forEach(p => counts[p.id] = 0);
        for (const [vId, tId] of Object.entries(game.votes)) {
            if (counts[tId] !== undefined) {
                // Le vote double du capitaine ne s'applique que pendant le vote du jour, pas l'élection
                counts[tId]++;
            }
        }
        io.to(game.id).emit('updateVotes', counts);
    }
    
    // La nuit, on envoie les votes uniquement aux loups pour qu'ils voient qui est ciblé
    if (game.phase === 'night') {
        const counts = {};
        game.players.forEach(p => counts[p.id] = 0);
        for (const [vId, tId] of Object.entries(game.votes)) {
            if (counts[tId] !== undefined) counts[tId]++;
        }
        
        const wolves = game.players.filter(p => p.role === 'Loup-Garou');
        wolves.forEach(w => io.to(w.id).emit('updateVotes', counts));
    }

    // Si c'est un humain qui vote le jour, déclencher la réaction des bots
    if (game.phase === 'day' && !voter.isBot) {
        // Petit délai pour simuler la réaction
        setTimeout(() => adjustBotVotes(game), 1500 + Math.random() * 2000);
    }
    
    const target = game.players.find(p => p.id === targetId);

    if (voter && target) {
        // Log public le jour, privé aux loups la nuit
        if (game.phase === 'day' || game.phase === 'captain_election') {
            io.to(game.id).emit('voteLog', { voterName: voter.name, targetName: target.name });
        } else if (game.phase === 'night') {
            // Envoyer info aux loups seulement
            const wolves = game.players.filter(p => p.role === 'Loup-Garou');
            wolves.forEach(w => {
                io.to(w.id).emit('info', `🐺 ${voter.name} cible ${target.name}`);
            });
        }
    }
}

function handleWitchAction(game, witchId, action, targetId) {
    const witch = game.players.find(p => p.id === witchId);
    if (!witch || witch.role !== 'Sorcière' || !witch.alive) return;

    if (action === 'save' && witch.potions.life && game.pendingVictim) {
        game.pendingVictim = null; // Sauvé !
        witch.potions.life = false;
        io.to(witchId).emit('info', "Vous avez utilisé votre potion de vie.");
    } else if (action === 'kill' && witch.potions.death && targetId) {
        game.witchKillTarget = targetId;
        witch.potions.death = false;
        io.to(witchId).emit('info', "Vous avez utilisé votre potion de mort.");
    } else if (action === 'skip') {
        io.to(witchId).emit('info', "Vous n'avez rien fait cette nuit.");
    }
    
    // Fin prématurée du tour sorcière si action faite (pour fluidité)
    // clearTimeout(game.timer);
    // endWitchPhase(game); 
    // Note: Pour simplifier la synchro avec les bots, on laisse le timer finir
}

// --- Phase de Préparation (Voleur -> Cupidon) ---

function startPreparationPhase(game) {
    // Le cycle de préparation est maintenant : Voleur -> Cupidon -> Voyante
    const thief = game.players.find(p => p.role === 'Voleur');
    if (thief) {
        startThiefPhase(game);
    } else {
        const cupid = game.players.find(p => p.role === 'Cupidon'); // Correction: on cherche Cupidon ici
        if (cupid) {
            startCupidTurn(game, cupid);
        } else {
            startSeerPhase(game); // Pas de prépa, on commence par la Voyante
        }
    }
}

function startThiefPhase(game) {
    const thief = game.players.find(p => p.id === game.thief?.thiefId);
    // S'il n'y a pas de voleur ou de cartes à voler, on passe à la suite
    if (!thief || !game.thief.extraCards) {
        return startCupidTurn(game);
    }
    game.phase = 'thief';
    io.to(game.id).emit('phaseChange', { phase: 'thief', duration: game.durations.THIEF, msg: '👤 Le Voleur se réveille...' });

    if (!thief.isBot) {
        io.to(thief.id).emit('thiefTurn', {
            currentRole: thief.role,
            extraCards: game.thief.extraCards
        });
    } else {
        // Logique Bot Voleur :
        // Si les deux cartes sont des loups, il prend un loup (obligatoire).
        // Sinon, 50% de chance d'échanger.
        setTimeout(() => {
            let choice = -1; // Garde sa carte
            if (game.thief.extraCards.includes('Loup-Garou')) choice = 0; // Prend la première carte si loup dispo (simplifié)
            else if (Math.random() > 0.5) choice = 0;
            
            handleThiefAction(game, thief.id, choice);
        }, game.durations.THIEF - 2000); // Agit vers la fin du tour
    }
    game.timer = setTimeout(() => endThiefPhase(game), game.durations.THIEF);
}

function handleThiefAction(game, thiefId, choiceIndex) {
    const thiefPlayer = game.players.find(p => p.id === thiefId);
    if (!thiefPlayer || thiefPlayer.role !== 'Voleur' || game.phase !== 'thief') return;

    let chosenCard = null;
    let actualChoiceIndex = choiceIndex;

    // Règle spéciale: si les 2 cartes sont des Loups-Garous, le Voleur DOIT en prendre un.
    if (game.thief.extraCards[0] === 'Loup-Garou' && game.thief.extraCards[1] === 'Loup-Garou') {
        if (actualChoiceIndex === -1) {
            actualChoiceIndex = 0; // Force le choix de la première carte
        }
    }

    if (actualChoiceIndex === 0 || actualChoiceIndex === 1) {
        chosenCard = game.thief.extraCards[actualChoiceIndex];
    }

    if (chosenCard) {
        thiefPlayer.role = chosenCard;
        // Echange de carte : Le Voleur met sa carte dans le talon
        game.thief.extraCards[actualChoiceIndex] = 'Voleur';
        
        io.to(thiefId).emit('info', `Vous avez changé de rôle. Vous êtes maintenant : ${chosenCard}.`);
    } else {
        io.to(thiefId).emit('info', `Vous avez gardé votre rôle de Voleur.`);
    }
    
    // Mettre à jour la liste des joueurs pour que le client ait le nouveau rôle
    io.to(game.id).emit('updatePlayerList', game.players);

    // Le tour du voleur est terminé
    clearTimeout(game.timer);
    endThiefPhase(game);
}

function endThiefPhase(game) {
    io.to(game.id).emit('info', '👤 Le Voleur s\'est rendormi.');
    // Correction du bug : on cherche Cupidon avant de lancer son tour
    const cupid = game.players.find(p => p.role === 'Cupidon');
    if (cupid) {
        startCupidTurn(game, cupid);
    } else {
        startSeerPhase(game);
    }
}

function startCupidTurn(game, cupid) { // Cupid est maintenant passé en paramètre
    game.phase = 'cupid';
    io.to(game.id).emit('phaseChange', { phase: 'cupid', duration: game.durations.CUPID, msg: '💘 Cupidon se réveille pour former un couple...' });
    
    if (!cupid.isBot) {
        io.to(cupid.id).emit('cupidTurn', { duration: game.durations.CUPID });
    } 
    // Bot Cupidon laisse le timer expirer (choix aléatoire géré dans endCupidTurn)
    game.timer = setTimeout(() => endCupidTurn(game), game.durations.CUPID);
}

function endCupidTurn(game) {
    if (!game.lovers || game.lovers.length < 2) {
        // Si cupidon n'a pas choisi, on choisit au hasard 2 joueurs vivants
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
        // Informer les amoureux de leur lien
        io.to(lover1.id).emit('loversInfo', { partnerId: lover2.id, partnerName: lover2.name });
        io.to(lover2.id).emit('loversInfo', { partnerId: lover1.id, partnerName: lover1.name });
        // Informer Cupidon (s'il existe et est en vie)
        if (cupid) io.to(cupid.id).emit('cupidResult', game.lovers);
    }

    startSeerPhase(game); // Après Cupidon, c'est la Voyante
}

// --- Gestion des Connexions Socket.io ---

io.on('connection', (socket) => {
    console.log('Un joueur connecté:', socket.id);

    // Fonction helper pour rejoindre une room
    const joinRoom = (game, { name, avatar }) => {
        // Si la salle était en sursis de suppression, on annule le compte à rebours
        if (game.deletionTimer) {
            clearTimeout(game.deletionTimer);
            game.deletionTimer = null;
        }

        socket.join(game.id);
        socket.roomId = game.id;

        const player = {
            id: socket.id,
            name: name,
            avatar: avatar,
            role: null,
            isBot: false,
            alive: true,
            potions: { life: true, death: true } // Pour la sorcière
        };
        game.players.push(player);
        io.to(game.id).emit('updatePlayerList', game.players);
        socket.emit('roomJoined', game.id);
    };

    socket.on('createPrivateGame', (playerData) => {
        const roomId = generateRoomId();
        games[roomId] = {
            id: roomId,
            players: [],
            phase: 'waiting',
            durations: DURATIONS, // Durées normales par défaut
            isPublic: false,
            votes: {},
            turn: 0,
            lovers: null,
            captainId: null,
            thief: null,
        };
        joinRoom(games[roomId], playerData);
    });

    socket.on('joinPrivateGame', ({ playerData, roomId }) => {
        const game = games[roomId];
        if (!game) return socket.emit('error', 'Partie introuvable.');
        if (game.phase !== 'waiting') return socket.emit('error', 'La partie a déjà commencé.');
        joinRoom(game, playerData);
    });

    // --- Reconnexion Automatique ---
    socket.on('rejoinGame', ({ roomId, oldPlayerId }) => {
        const game = games[roomId];
        if (!game) return socket.emit('reconnectFailed');

        const player = game.players.find(p => p.id === oldPlayerId);
        if (player) {
            // Mise à jour de l'ID socket
            player.id = socket.id;
            player.disconnected = false;
            socket.join(roomId);
            socket.roomId = roomId;

            console.log(`Joueur ${player.name} reconnecté.`);

            if (game.phase === 'waiting') {
                socket.emit('roomJoined', roomId);
                io.to(roomId).emit('updatePlayerList', game.players);
            } else {
                // Si la partie est en cours, on renvoie l'état
                socket.emit('gameStarted', game.players);
                socket.emit('phaseChange', { 
                    phase: game.phase, 
                    duration: 1000, // Durée fictive pour afficher la phase
                    msg: 'Reconnexion en cours...' 
                });
            }
        } else {
            socket.emit('reconnectFailed');
        }
    });

    // --- Relancer la partie ---
    socket.on('restartGame', () => {
        const game = games[socket.roomId];
        if (!game) return;

        // Réinitialisation complète
        game.phase = 'waiting';
        game.votes = {};
        game.turn = 0;
        game.lovers = null;
        game.captainId = null;
        game.thief = null;
        game.pendingVictim = null;
        game.witchKillTarget = null;
        
        game.players.forEach(p => {
            p.role = null;
            p.alive = true;
            p.potions = { life: true, death: true };
            p.knowledge = null;
        });

        io.to(game.id).emit('roomJoined', game.id);
        io.to(game.id).emit('updatePlayerList', game.players);
    });

    // Ancienne méthode (compatibilité si besoin, redirige vers create)
    socket.on('joinGame', (name) => socket.emit('error', 'Veuillez utiliser les nouveaux boutons.'));

    socket.on('startGame', ({ playerCount, devMode, forceRole }) => {
        const game = games[socket.roomId];
        if (!game) return;

        const realPlayerCount = game.players.length;
        if (realPlayerCount < 1) return;

        // Configuration du mode Dev
        if (devMode) {
            game.durations = DEV_DURATIONS;
            console.log(`Partie ${game.id} lancée en mode DEV.`);
        }

        game.votes = {}; 
        game.turn = 1;

        // 1. Remplir avec des Bots pour atteindre le nombre de joueurs souhaité
        let botCount = 1;
        while (game.players.length < parseInt(playerCount)) {
            game.players.push({
                id: `bot-${Date.now()}-${botCount}`,
                name: `Bot ${botCount}`,
                avatar: null, // Pas d'avatar spécifique pour les bots
                role: null,
                isBot: true,
                alive: true,
                potions: { life: true, death: true }
            });
            botCount++;
        }

        // 2. Générer la liste des rôles en fonction du nombre de joueurs
        const rolesToAssign = [];
        let hasThief = false;

        const numWolves = parseInt(playerCount) >= 12 ? 3 : 2;
        for (let i = 0; i < numWolves; i++) rolesToAssign.push('Loup-Garou');
        rolesToAssign.push('Sorcière');
        rolesToAssign.push('Voyante');
        rolesToAssign.push('Chasseur');
        rolesToAssign.push('Cupidon');
        if (parseInt(playerCount) >= 9) { // Le voleur est dispo à partir de 9 joueurs
            rolesToAssign.push('Voleur');
            hasThief = true;
        }
        
        // Remplir le reste avec des villageois
        while (rolesToAssign.length < parseInt(playerCount)) {
            rolesToAssign.push('Villageois');
        }

        // Si le voleur est en jeu, on ajoute 2 cartes villageois au pot
        if (hasThief) {
            rolesToAssign.push('Villageois', 'Villageois');
        }

        // 3. Assigner les rôles aléatoirement
        const shuffledRoles = rolesToAssign.sort(() => 0.5 - Math.random());

        // Gestion du rôle forcé (Mode Dev)
        if (devMode && forceRole) {
            // Trouver l'index du rôle forcé dans le paquet mélangé
            const roleIndex = shuffledRoles.indexOf(forceRole);
            if (roleIndex !== -1) {
                // Retirer le rôle du paquet
                shuffledRoles.splice(roleIndex, 1);
                // Assigner le rôle au joueur qui a lancé la partie (socket.id)
                const me = game.players.find(p => p.id === socket.id);
                if (me) me.role = forceRole;
            }
        }

        // Si le voleur est en jeu, on retire les 2 cartes en trop pour les mettre de côté
        if (hasThief) {
            game.thief = {
                thiefId: null,
                extraCards: [shuffledRoles.pop(), shuffledRoles.pop()]
            };
        }

        game.players.forEach((p, index) => {
            // Si le joueur a déjà un rôle (forcé), on saute
            if (!p.role) {
                p.role = shuffledRoles.pop();
            }
            
            if (p.role === 'Voleur' && game.thief) {
                game.thief.thiefId = p.id;
            }
        });

        io.to(game.id).emit('gameStarted', game.players);
        startPreparationPhase(game);
    });

    socket.on('vote', (targetId) => {
        const game = games[socket.roomId];
        if (game) handleVote(game, socket.id, targetId);
    });

    socket.on('cupidSelect', (targetIds) => {
        const game = games[socket.roomId];
        if (game && game.phase === 'cupid' && targetIds.length === 2) {
            game.lovers = targetIds;
            clearTimeout(game.timer);
            endCupidTurn(game);
        }
    });

    socket.on('seerAction', (targetId) => {
        const game = games[socket.roomId];
        if (game && game.phase === 'seer') {
            handleSeerAction(game, socket.id, targetId);
        }
    });

    socket.on('thiefChoice', (choiceIndex) => {
        const game = games[socket.roomId];
        if (game && game.phase === 'thief') {
            handleThiefAction(game, socket.id, choiceIndex);
        }
    });

    socket.on('witchAction', (data) => {
        const game = games[socket.roomId];
        if (game && game.phase === 'witch') {
            handleWitchAction(game, socket.id, data.action, data.targetId);
            // On ne ferme l'interface que si le joueur décide de passer/terminer
            if (data.action === 'skip') {
                socket.emit('witchTurnEnd');
            }
        }
    });

    socket.on('hunterShoot', async (targetId) => {
        const game = games[socket.roomId];
        if (game && game.phase === 'hunter_shot') {
            const hunter = game.players.find(p => p.id === socket.id);
            if (hunter && hunter.role === 'Chasseur') {
                clearTimeout(game.timer);
                if (game.hunterResolver) game.hunterResolver(targetId);
            }
        }
    });

    socket.on('captainSuccession', (targetId) => {
        const game = games[socket.roomId];
        if (game && game.phase === 'captain_succession') {
            clearTimeout(game.timer);
            if (game.successionResolver) game.successionResolver(targetId);
        }
    });

    // Permet au client de redemander la liste des joueurs pour forcer un rafraîchissement
    socket.on('requestPlayerList', () => {
        const game = games[socket.roomId];
        if (game) {
            io.to(game.id).emit('updatePlayerList', game.players);
        }
    });

    socket.on('disconnect', () => {
        const game = games[socket.roomId];
        if (game) {
            const player = game.players.find(p => p.id === socket.id);
            if (player) player.disconnected = true;

            if (game.phase === 'waiting') {
                // Délai de grâce de 5 secondes pour reconnexion rapide (ex: refresh page)
                setTimeout(() => {
                    // On vérifie si le joueur est toujours marqué déconnecté
                    if (player && player.disconnected) {
                        game.players = game.players.filter(p => p.id !== player.id);
                        io.to(game.id).emit('updatePlayerList', game.players);

                        if (game.players.length === 0) {
                            game.deletionTimer = setTimeout(() => {
                                if (games[game.id] && games[game.id].players.length === 0) {
                                    delete games[game.id];
                                }
                            }, 120000); 
                        }
                    }
                }, 5000);
            }
        } else if (game && game.players.length === 0 && game.phase !== 'waiting') {
            // Nettoyage si tout le monde part en cours de jeu
            clearTimeout(game.timer);
            delete games[game.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
});