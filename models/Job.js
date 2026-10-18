const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  payload: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ["pending", "running", "done", "failed"], default: "pending" },
  attempts: { type: Number, default: 0 },
  availableAt: { type: Date, default: Date.now },
  lockedUntil: Date,
  lockToken: String,
  lastError: String,
  finishedAt: Date,
}, { timestamps: true });
schema.index({ status: 1, availableAt: 1, lockedUntil: 1 });
module.exports = mongoose.model("Job", schema);
