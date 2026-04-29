const mongoose = require("mongoose");

const localizedTextSchema = new mongoose.Schema(
  {
    vi: { type: String, default: "" },
    en: { type: String, default: "" },
    jp: { type: String, default: "" },
    zh: { type: String, default: "" },
  },
  { _id: false },
);

const blogSectionSchema = new mongoose.Schema(
  {
    heading: localizedTextSchema,
    paragraphs: { type: [localizedTextSchema], default: [] },
  },
  { _id: false },
);

const blogFaqSchema = new mongoose.Schema(
  {
    question: localizedTextSchema,
    answer: localizedTextSchema,
  },
  { _id: false },
);

const blogPostSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    title: localizedTextSchema,
    metaTitle: localizedTextSchema,
    metaDescription: localizedTextSchema,
    excerpt: localizedTextSchema,
    thumbnail: { type: String, default: "/img/gallery/1.jpg" },
    thumbnailAlt: localizedTextSchema,
    keywords: { type: [String], default: [] },
    sections: { type: [blogSectionSchema], default: [] },
    faq: { type: [blogFaqSchema], default: [] },
    date: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("BlogPost", blogPostSchema);
