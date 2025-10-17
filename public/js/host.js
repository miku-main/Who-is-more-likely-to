const socket = io();

let currentCode = null;
let snapshot = null;

const el = (id) => document.getElementById(id);
const escapeHtml = (s) => 
    s.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

el("createBtn").onclick = () => {
    socket.emit("host:createRoom", { winningScore: Number(el("winScore").value) || 10 });
};

el("savePromptsBtn").onclick = () => {
    socket.emit("host:setPrompts", { code: currentCode, raw: el("prompts").value });
}

el("startRoundBtn").onclick = () => socket.emit("host:startRound", { code: currentCode });
el("nextRoundBtn").onclick = () => socket.emit("host:nextRound", { code: currentCode });

socket.on("host:roomCreated", ({ code, snapshot: snap }) => {
    currentCode = code;
    snapshot = snap;
    el("roomInfo").style.display = "block";
    el("roomCode").textContent = code;
    el("savePromptsBtn").disabled = false;
    el("startRoundBtn").disabled = false;
    render(snapshot);
});

socket.on("room:update", (snap) => {
    snapshot = snap;
    render(snapshot);
});

socket.on("round:started", (snap) => {
    snapshot = snap;
    el("nextRoundBtn").disabled = true;
    el("startRoundBtn").disabled = true;
    render(snapshot);
});

socket.on("round:voteProgress", ({ tally }) => {
    renderTally(tally);
});

socket.on("round:results", ({ snapshot: snap, tally, winners }) => {
    snapshot = snap;
    render(snapshot);
    renderTally(tally, true);
    el("nextRoundBtn").disabled = winners && winners.length > 0;
    el("startRoundBtn").disabled = true;
    if (winners && winners.length) {
        alert("Winner" + (winners.length > 1 ? "s" : "") + ": " + winners.join(", "));
    } else {
        el("nextRoundBtn").disabled = false;
    }
});

socket.on("host:toast", (msg) => alert(msg));
socket.on("host:disconnected", () => alert("Host disconnected. Room closed."));

function render(snap) {
    el("lobbyInfo").textContent =
        `${snap.players.length} player(s) • Prompts ${snap.usedPromptCount}/${snap.totalPrompts} • Status: ${snap.status}`;
    const list = snap.players
        .map(p => `<div class="player"><div><b>${escapeHtml(p.name)}</b></div><div class="score">Score: ${p.score}</div><div>${p.connected ? "🟢" : "🔴"}</div></div>`)
        .join("");
    el("players").innerHTML = list || '<div class="player">No players yet.</div>';

    el("prompt").textContent = snap.currentPrompt || "-";

    const canStart = snap.totalPrompts > snap.usedPromptCount && snap.players.length > 0 && snap.status !== "finished";
    el("startRoundBtn").disabled = !canStart || snap.status === "round";
    el("nextRoundBtn").disabled = !(snap.status === "reveal");

    if (snap.status !== "reveal") el("tally").innerHTML = "";
}

function renderTally(tally, finalize=false) {
    const idToName = Object.fromEntries(snapshot.players.map(p => [p.id, p.name]));
    const entries = Object.entries(tally || {}).sort((a,b)=>b[1]-a[1]);
    const max = Math.max(1, ...entries.map(([,v])=>v));
    el("tally").innerHTML = entries.length
        ? entries.map(([pid, v]) => `
        <div class="tally">
            <div><b>${escapeHtml(idToName[pid] || "Unknown")}</b> ${finalize ? `(+${v})` : ""}</div>
            <div class="bar"><div class="fill" style="width:${(v/max)*100}%"></div></div>
        </div>
        `).join("")
        : "<div class='footer'>No votes yet…</div>";
}