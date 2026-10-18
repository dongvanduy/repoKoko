const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  shopId: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  capacity: { type: Number, required: true, min: 1 },
  reserved: { type: Number, default: 0, min: 0 },
});
schema.index({ shopId: 1, date: 1, time: 1 }, { unique: true });
module.exports = mongoose.model("SlotInventory", schema);
