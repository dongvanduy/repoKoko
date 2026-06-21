const mongoose = require("mongoose");

const bookingStatusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, default: "" },
    to: { type: String, required: true },
    note: { type: String, default: "" },
    changedBy: { type: String, default: "System" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const bookingNoteSchema = new mongoose.Schema(
  {
    content: { type: String, required: true },
    createdBy: { type: String, default: "Admin" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const bookingSchema = new mongoose.Schema({
  // Thông tin người đặt (Đại diện)
  fullname: String,
  email: String,
  phone: String,
  planName: String,

  // Thông tin chung
  shopId: String,
  shopName: String,
  date: String,
  time: String,
  totalPrice: Number,
  bookingCode: { type: String, unique: true, sparse: true, trim: true },

  // Chi tiết từng khách (Quan trọng)
  guests: [
    {
      planName: String,
      price: Number,
      guestIndex: Number, // Khách số 1, 2...
      selectedOptions: [String], // Các tùy chọn khách đó chọn
    },
  ],

  status: { type: String, default: "Mới" },
  statusHistory: { type: [bookingStatusHistorySchema], default: [] },
  notes: { type: [bookingNoteSchema], default: [] },
  cancelledAt: Date,
  archivedAt: Date,
  createdAt: { type: Date, default: Date.now },
  // Thêm dòng này vào trong schema
  language: { type: String, default: "vi" },
});

bookingSchema.index({ date: 1, time: 1, status: 1 });
bookingSchema.index({ email: 1, createdAt: -1 });

const Booking = mongoose.model("Booking", bookingSchema);
module.exports = Booking;
