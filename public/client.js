// public/client.js

const socket = io();
// --- Initialisation des modales Bootstrap ---
let thiefModal, myRoleModal;
// Sécurité : on vérifie que Bootstrap est bien chargé pour éviter le crash sur mobile
if (typeof bootstrap !== 'undefined') {
    thiefModal = new bootstrap.Modal(document.getElementById('thiefModal'));
    myRoleModal = new bootstrap.Modal(document.getElementById('myRoleModal'));
} else {
    console.error("Bootstrap n'a pas pu être chargé.");
    alert("Erreur : L'interface graphique n'a pas pu charger. Vérifiez votre connexion.");
}


// --- Variables d'état du jeu ---
let myId = null;
let timerInterval = null;
let currentPhase = 'waiting';
let isGameOver = false;

// États pour les actions spéciales
let isHunterShooting = false;
let isWitchKilling = false; // Gardé car c'est un sous-état de la phase 'witch'

let myRole = null;
let cupidSelection = [];
let myLoverId = null;
let knownLovers = []; // Pour Cupidon
let seerVisions = {}; // Pour la mémoire de la voyante
let players = []; // Liste locale des joueurs
let captainId = null; // ID du capitaine actuel

// --- Descriptions des rôles pour l'aide ---
const ROLES_DETAILS = {
    'Loup-Garou': {
        name: '🐺 Loup-Garou',
        description: "Chaque nuit, vous vous concertez avec les autres loups pour dévorer un Villageois. Le jour, vous devez vous faire passer pour un innocent."
    },
    'Villageois': {
        name: '🧑‍🌾 Simple Villageois',
        description: "Vous n'avez aucune compétence particulière, mais votre vote est crucial pour éliminer les Loups-Garous."
    },
    'Sorcière': {
        name: '🧙‍♀️ Sorcière',
        description: "Vous disposez de deux potions uniques : une pour sauver la victime des loups, une pour empoisonner un joueur de votre choix durant la nuit."
    },
    'Voyante': {
        name: '👁️ Voyante',
        description: "Chaque nuit, vous pouvez espionner un joueur et découvrir son vrai rôle. Vous devez aider le village avec discrétion."
    },
    'Chasseur': {
        name: '🏹 Chasseur',
        description: "Si vous êtes éliminé, vous avez le droit d'utiliser votre dernière balle pour tuer immédiatement un autre joueur de son choix."
    },
    'Cupidon': {
        name: '💘 Cupidon',
        description: "La première nuit, vous désignez deux joueurs qui tombent amoureux. Si l'un meurt, l'autre meurt de chagrin."
    },
    'Voleur': {
        name: '👤 Voleur',
        description: "La première nuit, vous pouvez voir deux cartes non distribuées et échanger la vôtre avec l'une d'elles. Si les deux cartes sont des Loups-Garous, vous êtes obligé d'en devenir un."
    }
};

// --- Éléments du DOM (Interface) ---
const loginArea = document.getElementById('loginArea');
const lobbyArea = document.getElementById('lobbyArea');
const gameArea = document.getElementById('gameArea');
const playerList = document.getElementById('playerList');
const gameBoard = document.getElementById('gameBoard');
const logDiv = document.getElementById('gameLog');
const witchInterface = document.getElementById('witchInterface');

// --- Initialisation ---

// Vérifier si un code de salle est présent dans l'URL pour rejoindre direct
const usernameInput = document.getElementById('username');
const savedName = localStorage.getItem('lg_playerName');
if (savedName) {
    usernameInput.value = savedName;
    // On pourrait ajouter un bouton "Changer de pseudo" qui clear le localStorage
}

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('room')) {
    document.getElementById('roomIdInput').value = urlParams.get('room');
}

// Gestion du Mode Dev
const devModeCheckbox = document.getElementById('devMode');
const forceRoleSelect = document.getElementById('forceRole');

// Remplir le select des rôles
Object.keys(ROLES_DETAILS).forEach(role => {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = ROLES_DETAILS[role].name;
    forceRoleSelect.appendChild(option);
});

devModeCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
        forceRoleSelect.classList.remove('d-none');
    } else {
        forceRoleSelect.classList.add('d-none');
    }
});

// --- Prévisualisation des rôles ---
const playerCountSelect = document.getElementById('playerCount');
const rolesPreview = document.getElementById('rolesPreview');

function updateRolesPreview() {
    const count = parseInt(playerCountSelect.value);
    const roles = [];

    // Loups
    const numWolves = count >= 12 ? 3 : 2;
    roles.push(`${numWolves} Loups-Garous`);

    // Spéciaux
    roles.push('Sorcière', 'Voyante', 'Chasseur', 'Cupidon');

    let usedSlots = numWolves + 4;

    // Voleur (à partir de 9 joueurs, comme sur le serveur)
    if (count >= 9) {
        roles.push('Voleur');
        usedSlots++;
    }

    // Villageois
    const numVillagers = count - usedSlots;
    if (numVillagers > 0) roles.push(`${numVillagers} Simple(s) Villageois`);

    rolesPreview.innerHTML = `<strong>Composition :</strong><br>${roles.join(', ')}`;
}

if (playerCountSelect) {
    playerCountSelect.addEventListener('change', updateRolesPreview);
    updateRolesPreview(); // Initialisation
}

// --- Gestion des Boutons (Lobby) ---

function getPlayerData() {
    const name = document.getElementById('username').value;
    if (!name) {
        alert("Entrez un pseudo !");
        return null;
    }
    return { name, avatar: null }; // Plus d'avatar sélectionné
}

document.getElementById('btnCreatePrivate').addEventListener('click', () => {
    const playerData = getPlayerData();
    if(playerData) socket.emit('createPrivateGame', playerData);
});

document.getElementById('btnJoinPrivate').addEventListener('click', () => {
    const playerData = getPlayerData();
    const roomId = document.getElementById('roomIdInput').value.toUpperCase();
    if(playerData && roomId) socket.emit('joinPrivateGame', { playerData, roomId });
});

// Bouton de partage
const btnCopy = document.getElementById('btnCopyLink');
if (navigator.share) btnCopy.textContent = "Inviter des amis";

btnCopy.addEventListener('click', async () => {
    const url = window.location.href;
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Loups-Garous de Thiercelieux (Web)',
                text: 'Rejoins ma partie de Loups-Garous !',
                url: url
            });
        } catch (err) { console.log('Partage annulé'); }
    } else {
        navigator.clipboard.writeText(url).then(() => alert("Lien copié !"));
    }
});

// Lancer la partie
document.getElementById('btnStart').addEventListener('click', () => {
    const playerCount = document.getElementById('playerCount').value;
    const devMode = document.getElementById('devMode').checked;
    const forceRole = document.getElementById('forceRole').value;
    
    socket.emit('startGame', { playerCount, devMode, forceRole });
});

// --- Gestion des Boutons (Jeu - Sorcière) ---
document.getElementById('btnWitchSave').addEventListener('click', () => {
    socket.emit('witchAction', { action: 'save' });
});
document.getElementById('btnWitchSkip').addEventListener('click', () => {
    socket.emit('witchAction', { action: 'skip' });
});
document.getElementById('btnWitchKill').addEventListener('click', () => {
    isWitchKilling = true;
    document.getElementById('witchKillSelect').classList.remove('d-none');
    addLog("Sélectionnez un joueur à éliminer...");
});

// --- Écouteurs Socket.io (Réception des messages du serveur) ---

// Reconnexion automatique
socket.on('connect', () => {
    const savedRoom = localStorage.getItem('lg_roomId');
    const savedId = localStorage.getItem('lg_playerId');
    if (savedRoom && savedId) {
        socket.emit('rejoinGame', { roomId: savedRoom, oldPlayerId: savedId, name: localStorage.getItem('lg_playerName') });
    }
});

socket.on('roomJoined', (roomId) => {
    document.getElementById('displayRoomId').textContent = roomId;
    loginArea.classList.add('d-none');
    lobbyArea.classList.remove('d-none');

    // Mettre à jour l'URL sans recharger la page
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + roomId;
    window.history.pushState({path:newUrl}, '', newUrl);

    // Sauvegarde pour reconnexion
    localStorage.setItem('lg_roomId', roomId);
    localStorage.setItem('lg_playerId', socket.id);
    localStorage.setItem('lg_playerName', document.getElementById('username').value);
});

socket.on('error', (msg) => {
    alert(msg);
});

socket.on('updatePlayerList', (updatedPlayers) => {
    players = updatedPlayers; // Mise à jour de la liste locale des joueurs
    playerList.innerHTML = '';
    updatedPlayers.forEach(p => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.innerHTML = `<img src="${p.avatar || 'https://placehold.co/50x50?text=?'}" class="player-avatar"> 
                        ${p.name} 
                        ${p.isBot ? ' (Bot 🤖)' : ''}`;
        playerList.appendChild(li);
    });

    // Mettre à jour mon rôle localement si je suis dans la liste
    const me = players.find(p => p.id === socket.id);
    if (me) {
        myRole = me.role;
    }
    
    // Si le jeu est en cours, on met à jour le plateau pour refléter les changements de rôle (ex: Voleur)
    if (gameArea.style.display === 'block') {
        renderBoard();
    }
});

socket.on('gameStarted', (initialPlayers) => {
    lobbyArea.classList.add('d-none');
    gameArea.style.display = 'block';
    players = initialPlayers; // Stockage initial de la liste des joueurs
    
    // Initialisation des données du joueur local
    const me = players.find(p => p.id === socket.id);
    if(me) {
        myRole = me.role;
        myId = socket.id;
    } else {
        myRole = null;
    }

    renderBoard();
    showMyRole(); // Afficher le rôle dès le début
    addLog("La partie commence ! Les rôles ont été distribués.");
});

socket.on('reconnectFailed', () => {
    localStorage.removeItem('lg_roomId');
    localStorage.removeItem('lg_playerId');
    // On garde le nom du joueur pour le confort
    window.location.href = "/"; // Retour accueil
});

// Changement de phase (Jour, Nuit, etc.)
socket.on('phaseChange', (data) => {
    currentPhase = data.phase;
    document.getElementById('phaseDisplay').innerHTML = `${data.msg} <span id="timerDisplay" class="badge bg-dark ms-2">--:--</span>`;
    startTimer(data.duration);
    
    // Réinitialisation de l'interface
    document.querySelectorAll('.vote-badge').forEach(el => el.style.display = 'none');
    witchInterface.style.display = 'none';
    thiefModal.hide(); // Fermer la modale voleur si le temps est écoulé
    
    // Réinitialisation des états d'action
    isWitchKilling = false;

    // Nettoyage des bordures spéciales
    document.querySelectorAll('.role-card').forEach(c => c.classList.remove('hunter-target', 'cupid-target', 'captain-target', 'seer-target'));
    renderBoard(); // IMPORTANT : S'assurer que le plateau est visible et à jour à chaque nouvelle phase
});

socket.on('playerKilled', (data) => {
    // Support rétrocompatible (si data est juste un ID) ou objet {id, role}
    const playerId = data.id || data;
    const role = data.role;

    const player = players.find(p => p.id === playerId);
    if (player) {
        player.alive = false;
        if (role) player.role = role; // On enregistre le rôle révélé
    }
    renderBoard(); // On redessine pour afficher le rôle
});

socket.on('info', (msg) => addLog(msg));

// --- Gestion des Rôles Spéciaux ---

// Sorcière
socket.on('witchTurn', (data) => {
    witchInterface.style.display = 'block';
    document.getElementById('witchKillSelect').classList.add('d-none');
    
    const info = document.getElementById('witchInfo');
    const btnSave = document.getElementById('btnWitchSave');
    const btnKill = document.getElementById('btnWitchKill');
    const btnSkip = document.getElementById('btnWitchSkip');

    // Réinitialiser les boutons (on supprime les anciens écouteurs via clonage ou nouvelle logique)
    renderBoard(); // FORCER L'AFFICHAGE DES CARTES (Correction bug affichage tour 1)
    // Ici on va juste réassigner les onclick pour faire simple et propre
    btnSave.disabled = false;
    btnKill.disabled = false;
    btnSkip.textContent = "Terminer / Ne rien faire";

    if (data.victimId) {
        info.textContent = `La victime des loups est : ${data.victimName}.`;
        if (data.potions.life) {
            btnSave.onclick = () => {
                socket.emit('witchAction', { action: 'save' });
                btnSave.disabled = true; // Désactiver après usage
                addLog("Vous avez utilisé la potion de vie.");
            };
        } else {
            btnSave.disabled = true;
        }
    } else {
        info.textContent = `Personne n'a été attaqué par les loups.`;
        btnSave.disabled = true;
    }
    
    if (data.potions.death) {
        btnKill.onclick = () => {
            isWitchKilling = true;
            document.getElementById('witchKillSelect').classList.remove('d-none');
            addLog("Sélectionnez un joueur à éliminer...");
            btnKill.disabled = true; // On considère qu'il va l'utiliser
        };
    } else {
        btnKill.disabled = true;
    }

    btnSkip.onclick = () => {
        socket.emit('witchAction', { action: 'skip' });
        witchInterface.style.display = 'none';
        isWitchKilling = false;
    };
});

socket.on('witchTurnEnd', () => {
    witchInterface.style.display = 'none';
    isWitchKilling = false;
});

// Chasseur
socket.on('hunterTurn', (data) => {
    isHunterShooting = true;
    addLog("🏹 CHASSEUR : Vous avez été éliminé ! Tirez sur un joueur pour l'emporter avec vous.");
    document.querySelectorAll('.role-card:not(.dead)').forEach(card => {
        if (!card.innerHTML.includes("C'est vous")) card.classList.add('hunter-target');
    });
});

// Cupidon
socket.on('cupidTurn', () => {
    cupidSelection = [];
    addLog("💘 CUPIDON : Choisissez deux joueurs à rendre amoureux.");
    document.querySelectorAll('.role-card:not(.dead)').forEach(card => card.classList.add('cupid-target'));
});

socket.on('loversInfo', (data) => {
    myLoverId = data.partnerId;
    socket.emit('requestPlayerList'); // On demande au serveur de renvoyer la liste pour rafraîchir l'affichage
});

socket.on('revealLovers', (loversIds) => {
    knownLovers = loversIds;
    renderBoard();
});
socket.on('cupidResult', (loversIds) => {
    knownLovers = loversIds;
    renderBoard();
});

// Voyante
socket.on('seerTurn', () => {
    addLog("👁️ VOYANTE : Sélectionnez un joueur pour voir son rôle.");
    document.querySelectorAll('.role-card:not(.dead)').forEach(card => {
        if (!card.innerHTML.includes("C'est vous")) card.classList.add('seer-target');
    });
});

socket.on('seerResult', (data) => {
    alert(`👁️ Vision de la Voyante :\n\nLe joueur ${data.name} est : ${data.role}`);
    seerVisions[data.targetId] = data.role; // On sauvegarde la vision
    addLog(`👁️ Vous avez découvert que ${data.name} est ${data.role}.`);
    document.querySelectorAll('.role-card').forEach(c => c.classList.remove('seer-target'));
    renderBoard(); // Rafraîchir pour afficher la vision
});

// Capitaine
socket.on('captainChange', (newCaptainId) => {
    captainId = newCaptainId; // Mettre à jour l'ID local du capitaine
    renderBoard();
});

socket.on('captainSuccessionTurn', () => {
    addLog("👑 CAPITAINE : Vous êtes mort ! Choisissez votre successeur.");
    document.querySelectorAll('.role-card:not(.dead)').forEach(card => card.classList.add('captain-target'));
});

// Voleur
socket.on('thiefTurn', (data) => {
    const choicesDiv = document.getElementById('thiefChoices');
    choicesDiv.innerHTML = '';

    // Afficher la carte actuelle du voleur
    choicesDiv.innerHTML += `
        <div class="col-4">
            <div class="card p-3 text-center bg-secondary">
                <h5>Votre carte</h5>
                <p class="mb-0">${data.currentRole}</p>
                <button class="btn btn-sm btn-light mt-2" disabled>Actuelle</button>
            </div>
        </div>
    `;

    // Afficher les deux cartes à voler
    data.extraCards.forEach((card, index) => {
        choicesDiv.innerHTML += `
            <div class="col-4">
                <div class="card p-3 text-center role-card" onclick="chooseThiefCard(${index})">
                    <h5>Choix ${index + 1}</h5>
                    <p class="mb-0 fw-bold text-warning">${card}</p>
                </div>
            </div>
        `;
    });
    thiefModal.show();
});

// --- Gestion des Votes ---

socket.on('updateVotes', (counts) => {
    for (const [playerId, count] of Object.entries(counts)) {
        const card = document.getElementById(`player-${playerId}`);
        if (card) {
            let badge = card.querySelector('.vote-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'vote-badge position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger';
                card.appendChild(badge);
            }
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
    }
});

socket.on('voteLog', (data) => {
    addLog(`${data.voterName} a voté contre ${data.targetName}.`);
});

socket.on('gameOver', (data) => {
    const msg = data.message || data; // Compatibilité
    alert(msg);
    
    if (data.players) {
        players = data.players; // Mettre à jour avec les rôles révélés
        if (data.lovers) knownLovers = data.lovers; // Révéler les amoureux pour l'affichage
        isGameOver = true;
        renderBoard();
        
        // Afficher les cartes du voleur si disponibles
        if (data.thiefCards) {
            const div = document.createElement('li');
            div.className = 'text-center mt-2 p-2 border rounded bg-secondary bg-opacity-25';
            div.innerHTML = '<small class="text-info d-block mb-2">Cartes du Voleur :</small><div class="d-flex justify-content-center gap-2">';
            data.thiefCards.forEach(card => {
                div.querySelector('div').innerHTML += `
                    <div class="card p-2 text-center bg-dark border-secondary" style="width: 100px;">
                        <small class="fw-bold text-white" style="font-size: 0.8rem;">${card}</small>
                    </div>`;
            });
            div.innerHTML += '</div>';
            logDiv.appendChild(div);
        }

        const li = document.createElement('li');
        li.className = 'text-center mt-3';
        li.innerHTML = `
            <button class="btn btn-primary btn-sm" onclick="location.reload()">Retour à l'accueil</button>
            <button class="btn btn-success btn-sm ms-2" id="btnRestart">Rejouer avec les mêmes joueurs</button>
        `;
        logDiv.appendChild(li);
        
        setTimeout(() => {
            document.getElementById('btnRestart')?.addEventListener('click', () => socket.emit('restartGame'));
        }, 100);

        logDiv.scrollTop = logDiv.scrollHeight;
    } else {
        location.reload();
    }
});

// --- Fonctions Utilitaires ---

function renderBoard() {
    // Sécurité : Si la liste est vide, on ne fait rien pour éviter de tout effacer
    if (!players || players.length === 0) {
        console.warn("renderBoard appelé avec une liste vide, affichage conservé.");
        return;
    }

    gameBoard.innerHTML = '';
    
    const me = players.find(p => p.id === myId);
    const amIWolf = me && me.role === 'Loup-Garou';

    players.forEach(p => {
        const col = document.createElement('div');
        col.className = 'col-md-4 mb-3';
        
        let cardClass = 'card p-3 text-center role-card';
        if (!p.alive) cardClass += ' dead';
        
        // Style spécifique pour MA carte
        if (p.id === myId) cardClass += ' my-card border-warning border-3';

        // Badge de Rôle (Gentil/Méchant)
        let roleBadge = '';
        const role = (p.id === myId || isGameOver || (!p.alive && p.role)) ? p.role : null;
        
        if (role) {
            const isBad = ['Loup-Garou'].includes(role);
            const badgeColor = isBad ? 'bg-danger' : 'bg-success';
            roleBadge = `<span class="badge ${badgeColor} d-block mt-1">${role}</span>`;
        }

        // Bouton d'aide (seulement sur ma carte)
        let helpBtn = '';
        if (p.id === myId) {
            helpBtn = `<button class="btn btn-sm btn-light position-absolute top-0 end-0 m-1 p-0 px-2 fw-bold" style="z-index: 10;" onclick="event.stopPropagation(); showMyRole()">?</button>`;
        }

        col.innerHTML = `
            <div id="player-${p.id}" class="${cardClass} position-relative" onclick="vote('${p.id}')">
                ${helpBtn}
                <img src="${p.avatar || 'https://placehold.co/150x150?text=?'}" class="player-avatar d-block mx-auto mb-2" alt="Avatar">
                <h5 class="mb-1">${p.name} ${p.isBot ? '🤖' : ''}</h5>
                <p class="mb-1 text-muted">${p.alive ? 'Vivant' : 'Mort ☠️'}</p>
                ${roleBadge}
                ${seerVisions[p.id] ? `<p class="mb-1 small text-info">Vu: ${seerVisions[p.id]}</p>` : ''}
                ${(amIWolf && p.role === 'Loup-Garou' && p.id !== myId && !isGameOver) ? '<span class="badge bg-danger mb-2">Loup</span>' : ''}
                ${(p.id === captainId) ? '<span class="card-icon">👑</span>' : ''}
                ${(p.id === myLoverId || knownLovers.includes(p.id) || (p.id === myId && myLoverId)) ? '<span class="card-icon">💘</span>' : ''}
            </div>
        `;
        gameBoard.appendChild(col);
    });
}

// Fonction principale de clic sur une carte
function vote(targetId) {
    // On utilise un switch sur la phase actuelle pour déterminer l'action
    switch (currentPhase) {
        case 'cupid':
            cupidSelection.push(targetId);
            document.getElementById(`player-${targetId}`).classList.remove('cupid-target');
            addLog(`Vous avez sélectionné un amoureux (${cupidSelection.length}/2).`);
            if (cupidSelection.length === 2) {
                socket.emit('cupidSelect', cupidSelection);
            }
            break;

        case 'seer':
            if(targetId === myId) return alert("Vous ne pouvez pas vous sonder vous-même !");
            socket.emit('seerAction', targetId);
            break;

        case 'captain_succession':
            socket.emit('captainSuccession', targetId);
            break;

        case 'witch':
            if (isWitchKilling) {
                socket.emit('witchAction', { action: 'kill', targetId: targetId });
                isWitchKilling = false; // Fin du mode sélection
                document.getElementById('witchKillSelect').classList.add('d-none');
                addLog("Vous avez utilisé la potion de mort.");
            }
            break;

        case 'hunter_shot':
            socket.emit('hunterShoot', targetId);
            break;

        case 'day':
        case 'night':
        case 'captain_election':
            // On peut voter pour soi-même uniquement pour l'élection du capitaine
            if(targetId === myId && currentPhase !== 'captain_election') return alert("Vous ne pouvez pas voter contre vous-même !");
            socket.emit('vote', targetId);
            break;
    }
}

function chooseThiefCard(index) {
    socket.emit('thiefChoice', index);
    thiefModal.hide();
}

// Fonction globale pour ouvrir la modale de rôle
window.showMyRole = function() {
    if (myRole && ROLES_DETAILS[myRole]) {
        const details = ROLES_DETAILS[myRole];
        document.getElementById('myRoleModalTitle').textContent = details.name;
        document.getElementById('myRoleModalDescription').textContent = details.description;
        myRoleModal.show();
    }
};

function addLog(msg) {
    const li = document.createElement('li');
    li.textContent = `> ${msg}`;
    // Vider le placeholder si c'est le premier log
    if (logDiv.querySelector('.text-muted')) {
        logDiv.innerHTML = '';
    }
    logDiv.appendChild(li);
    logDiv.scrollTop = logDiv.scrollHeight;
}

function startTimer(duration) {
    clearInterval(timerInterval);
    let timeLeft = duration / 1000;
    const display = document.getElementById('timerDisplay');
    
    display.textContent = timeLeft + 's';
    timerInterval = setInterval(() => {
        timeLeft--;
        display.textContent = timeLeft + 's';
        if (timeLeft <= 0) clearInterval(timerInterval);
    }, 1000);
}
