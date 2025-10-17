const socket = io();

let joined = false;
let currentCode = null;
let selfId = null;
let voted = false;
let lastSnapshot = null;

const $ = (id) => document.getElementById(id);

$("joinBtn").onclick = () => {
    const code = $("code").value.trim().toUpperCase();
    const name = $("name").value.trim();
    socket.emit("player:join", { code, name });
};

socket.on("connect", () => { selfId = socket.id; });

socket.on("player:joinResult", ({ ok, error, code, name, snapshot }) => {
    if (!ok) {
        $("joinMsg").textContent = error || "Unable to join.";
        return;
    }
    joined = true;
    currentCode = code;
    lastSnapshot = snapshot;

    $("joinCard").style.display = "none";
    $("gameCard").style.display = "block";
    $("roomCode").textContent = code;
    $("hello").textContent = `Hi, ${name}!`;
    render(snapshot);
});

socket.on("room:update", (snap) => {
    lastSnapshot = snap;
    render(snap);
});

socket.on("round:started", (snap) => {
    voted = false;
    lastSnapshot = snap;
    render(snap);
});

socket.on("round:results", ({ snapshot, tally }) => {
    lastSnapshot = snapshot;
    render(snapshot);
});

socket.on("game:finished", ({ winners, snapshot }) => {
    lastSnapshot = snapshot;
    render(snapshot);
    alert("Game finished! Winner" + (winners.length > 1 ? "s" : "") + ": " + winners.join(", "));
});

function render(snap) {
    $("status").textContent = `Status: ${snap.status}`;
    $("prompt").textContent = snap.currentPrompt || "-";

    const options = $("options");
    options.innerHTML = "";

    if (snap.status === "round" && snap.currentPrompt) {
        snap.players.forEach(p => {
            const btn = document.createElement("button");
            btn.className = "opt" + (voted ? " disabled": "");
            btn.textContent = p.name;
            btn.onclick = () => {
                if (voted) return;
                socket.emit("player:vote", { code: currentCode, targetId: p.id });
                voted = true;
                $("afterVote").style.display = "block";
                updateDisabled();
            };
            options.appendChild(btn);
        });
    } else {
        $("afterVote").style.display = "none";
    }

    updateDisabled();
}

function updateDisabled() {
    const disabled = lastSnapshot?.status !== "round" || voted;
    document.querySelectorAll(".opt").forEach(el => {
        if (disabled) el.classList.add("disabled");
        else el.classList.remove("disabled");
    });
}