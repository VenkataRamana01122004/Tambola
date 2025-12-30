// server/index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { randomUUID } = require("crypto");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const games = {};

// ---------------- HELPERS ----------------
function generateTicket() {
  const set = new Set();
  while (set.size < 15) set.add(Math.floor(Math.random() * 90) + 1);
  return [...set];
}

function firstFive(ticket, called) {
  return ticket.filter(n => called.has(n)).length >= 5;
}
function lineComplete(ticket, called, start) {
  return ticket.slice(start, start + 5).every(n => called.has(n));
}
function fullHouse(ticket, called) {
  return ticket.every(n => called.has(n));
}

// ---------------- SOCKET ----------------
io.on("connection", socket => {
  // console.log("✅ Connected:", socket.id);

  // ---------- CREATE GAME ----------
  socket.on("host_create_game", () => {
    const roomCode = randomUUID().slice(0, 6).toUpperCase();

    games[roomCode] = {
      hostId: socket.id,
      players: {},
      tickets: {},
      called: [],
      calledSet: new Set(),
      current: null,
      claims: {
        FIRST_FIVE: null,
        FIRST_LINE: null,
        MIDDLE_LINE: null,
        LAST_LINE: null,
        FULL_HOUSE: null
      }
    };

    socket.join(roomCode);
    socket.emit("game_created", { roomCode });
  });

  // ---------- ADD PLAYER ----------
  socket.on("host_add_player", ({ roomCode, playerName }) => {
    const g = games[roomCode];
    if (!g) return;

    const playerCode = randomUUID().slice(0, 4).toUpperCase();
    g.players[playerCode] = { playerName };
    g.tickets[playerCode] = [];

    io.to(roomCode).emit("player_added", { playerCode, playerName });
  });

  // ---------- ASSIGN TICKETS ----------
  socket.on("host_assign_ticket", ({ roomCode, playerCode, count = 1 }) => {
    const g = games[roomCode];
    if (!g) return;

    for (let i = 0; i < count; i++) {
      g.tickets[playerCode].push(generateTicket());
    }

    io.to(roomCode).emit("ticket_assigned", { playerCode });
  });

  // ---------- CALL NUMBER ----------
  socket.on("host_call_number", ({ roomCode }) => {
    const g = games[roomCode];
    if (!g) return;
    if (g.calledSet.size === 90) return;

    let n;
    do { n = Math.floor(Math.random() * 90) + 1; }
    while (g.calledSet.has(n));

    g.calledSet.add(n);
    g.called.push(n);
    g.current = n;

    io.to(roomCode).emit("number_called", {
      number: n,
      called: g.called
    });
  });

  // ---------- 🚀 NEW GAME = NEW ROOM ----------
  socket.on("host_new_game", ({ oldRoomCode }) => {
    const oldGame = games[oldRoomCode];
    if (!oldGame) return;

    // 🔥 Remove old room completely
    delete games[oldRoomCode];
    io.to(oldRoomCode).emit("room_closed");

    // 🚀 Create fresh room
    const newRoomCode = randomUUID().slice(0, 6).toUpperCase();

    games[newRoomCode] = {
      hostId: socket.id,
      players: {},
      tickets: {},
      called: [],
      calledSet: new Set(),
      current: null,
      claims: {
        FIRST_FIVE: null,
        FIRST_LINE: null,
        MIDDLE_LINE: null,
        LAST_LINE: null,
        FULL_HOUSE: null
      }
    };

    socket.leave(oldRoomCode);
    socket.join(newRoomCode);

    socket.emit("game_created", { roomCode: newRoomCode });
  });

  // ---------- PLAYER JOIN ----------
  socket.on("player_join_with_code", ({ playerCode }) => {
    for (const roomCode in games) {
      const g = games[roomCode];
      if (g.tickets[playerCode]) {
        socket.join(roomCode);
        socket.emit("player_joined", {
          roomCode,
          playerName: g.players[playerCode].playerName,
          tickets: g.tickets[playerCode],
          called: g.called,
          current: g.current,
          claims: g.claims
        });
        return;
      }
    }
    socket.emit("join_error", { message: "Invalid player code" });
  });

  // ---------- CLAIM ----------
  socket.on("player_claim", ({ roomCode, playerCode, claimType }) => {
    const g = games[roomCode];
    if (!g || g.claims[claimType]) return;

    const tickets = g.tickets[playerCode];
    const called = g.calledSet;

    let valid = false;
    for (const t of tickets) {
      if (
        (claimType === "FIRST_FIVE" && firstFive(t, called)) ||
        (claimType === "FIRST_LINE" && lineComplete(t, called, 0)) ||
        (claimType === "MIDDLE_LINE" && lineComplete(t, called, 5)) ||
        (claimType === "LAST_LINE" && lineComplete(t, called, 10)) ||
        (claimType === "FULL_HOUSE" && fullHouse(t, called))
      ) {
        valid = true;
        break;
      }
    }

    if (!valid) {
      socket.emit("claim_rejected", { claimType });
      return;
    }

    const winner = g.players[playerCode].playerName;
    g.claims[claimType] = winner;

    io.to(roomCode).emit("claim_accepted", { claimType, winner });
  });
});

app.get("/", (req, res) => {
  res.send("Tambola Server is running 🚀");
});


server.listen(4000, () =>
  console.log()
  // console.log("🚀 Server running on http://localhost:4000")
);
