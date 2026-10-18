require("dotenv").config({ path: require("node:path").join(__dirname, ".env"), quiet: true });
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const i18n = require("i18n");
const cookieParser = require("cookie-parser");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");
const { requireAdminCsrf } = require("./middleware/admin-csrf");

// Import Models
const Booking = require("./models/booking");
const Plan = require("./models/Plan");
const Config = require("./models/Config");
const BlogPost = require("./models/BlogPost");

// Import dữ liệu tĩnh (để dùng fallback cho shops, options)
const {
  plans: initialPlans,
  shops,
  options,
  galleryImages,
} = require("./data");
const {
  siteUrl,
  defaultSeoImage,
  rentalPlans,
  landingPage,
  photoshootPage,
  blogPosts,
  getSeoLabels,
  applyPostLocaleOverride,
  getPostBySlug,
  getRelatedPosts,
} = require("./seo-content");

const MongoStore = require("connect-mongo");
const compression = require("compression");
const { headers, csrfToken, rateLimit } = require("./middleware/security");
const { upload, manageUploads, publishUploads } = require("./middleware/uploads");
const BookingService = require("./services/bookings");
const { localizeSeoObject } = require("./services/seo");
const { initialText } = require("./services/translations");
const Job = require("./models/Job");
const { AppError, safeErrorDetails, normalizeUploadError } = require("./lib/errors");
const { text, integer, safeImageUrl, jsonForHtml } = require("./lib/validation");
const { messages, errorMessage } = require("./lib/messages");
const { tokyoDate, validDate } = require("./lib/time");
const { asset, responsiveImage, assertAssetsBuilt } = require("./lib/assets");
const { validateConfig } = require("./lib/config");
const { languageReturnPath } = require("./lib/navigation");
const app = express();
// Template helpers are available for every render, including early error responses.
Object.assign(app.locals, { asset, responsiveImage, jsonLd: jsonForHtml });
app.disable("x-powered-by");

mongoose.set("bufferCommands", false);

const DEFAULT_HERO_IMAGE =
  "https://static.kyotokimonorental.com/app/img/top/hero/autumn/vi/sp/hero01.webp";

const isDbConnected = () => mongoose.connection.readyState === 1;

const getVisiblePlans = async () => {
  if (!isDbConnected()) return initialPlans.filter((plan) => plan.isVisible !== false);

  try {
    return await Plan.find({ isVisible: true }).lean();
  } catch (err) {
    console.error(JSON.stringify({ event: "request_error" }));
    return initialPlans.filter((plan) => plan.isVisible !== false);
  }
};

const getAllPlans = async () => {
  if (!isDbConnected()) return initialPlans;

  try {
    return await Plan.find().lean();
  } catch (err) {
    console.error(JSON.stringify({ event: "request_error" }));
    return initialPlans;
  }
};

const getHeroImages = async () => {
  if (!isDbConnected()) return [DEFAULT_HERO_IMAGE];

  try {
    const heroConfig = await Config.findOne({ key: "hero_image" });
    if (!heroConfig || !heroConfig.value) return [DEFAULT_HERO_IMAGE];

    if (Array.isArray(heroConfig.value)) return heroConfig.value;

    if (
      typeof heroConfig.value === "string" &&
      heroConfig.value.startsWith("[")
    ) {
      return JSON.parse(heroConfig.value);
    }

    return [heroConfig.value];
  } catch (err) {
    console.error(JSON.stringify({ event: "request_error" }));
    return [DEFAULT_HERO_IMAGE];
  }
};

const absoluteUrl = (value = "/") => {
  if (!value) return siteUrl;
  if (/^https?:\/\//i.test(value)) return value;
  return `${siteUrl}${value.startsWith("/") ? value : `/${value}`}`;
};

const escapeJsonForHtml = jsonForHtml;

const buildSeo = ({
  title,
  description,
  path: pagePath = "/",
  image = defaultSeoImage,
  type = "website",
  locale = "en",
}) => ({
  title,
  description,
  canonical:
    locale && locale !== "en"
      ? `${absoluteUrl(pagePath)}?lang=${locale}`
      : absoluteUrl(pagePath),
  hrefLangs: {
    en: absoluteUrl(pagePath),
    vi: `${absoluteUrl(pagePath)}?lang=vi`,
    ja: `${absoluteUrl(pagePath)}?lang=jp`,
    "zh-CN": `${absoluteUrl(pagePath)}?lang=zh`,
    "x-default": absoluteUrl(pagePath),
  },
  image: absoluteUrl(image),
  type,
});

const buildBreadcrumbSchema = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path),
  })),
});

const buildFaqSchema = (faqItems = []) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
});

const buildLocalBusinessSchema = () => {
  const shop = shops[0] || {};

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${siteUrl}/#localbusiness`,
    name: "Kokoro Kimono Rental",
    url: siteUrl,
    image: absoluteUrl(defaultSeoImage),
    telephone: "080-9631-0559",
    address: shop.address
      ? {
          "@type": "PostalAddress",
          streetAddress: shop.address,
          addressLocality: "Kyoto",
          addressRegion: "Kyoto",
          postalCode: "605-0874",
          addressCountry: "JP",
        }
      : "TODO: Add verified shop address",
    openingHours: "Mo-Su 09:00-18:00",
    areaServed: ["Kyoto", "Higashiyama", "Kiyomizu"],
    sameAs: [
      "https://www.instagram.com/kokoroo_kimono/",
      "https://www.facebook.com/profile.php?id=61581964378678",
    ],
  };
};

const buildArticleSchema = (post) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  headline: post.title,
  description: post.metaDescription,
  image: [absoluteUrl(post.thumbnail)],
  datePublished: post.date,
  dateModified: post.date,
  author: {
    "@type": "Organization",
    name: "Kokoro Kimono Rental",
  },
  publisher: {
    "@type": "Organization",
    name: "Kokoro Kimono Rental",
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/img/common/logo.png"),
    },
  },
  mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
});

const getSeoLocale = req => ["vi", "en", "jp", "zh"].includes(req.getLocale()) ? req.getLocale() : "en";
const localizeSeoObjectSegmented = localizeSeoObject;

const getLocalizedField = (field, locale) => {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field[locale] || field.en || field.vi || field.jp || field.zh || "";
};

const normalizeSlug = (value) => {
  const raw = normalizeEnv(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return raw || `blog-${Date.now()}`;
};

const ensureUniqueBlogSlug = async (slug, existingId = null) => {
  let candidate = normalizeSlug(slug);
  let index = 2;

  while (isDbConnected()) {
    const query = { slug: candidate };
    if (existingId) query._id = { $ne: existingId };
    const existingPost = await BlogPost.findOne(query).select("_id").lean();
    if (!existingPost) return candidate;
    candidate = `${normalizeSlug(slug)}-${index}`;
    index += 1;
  }

  return candidate;
};

const parseBlogSections = (content, fallbackHeading) => {
  const normalized = normalizeEnv(content).replace(/\r\n/g, "\n");
  if (!normalized) {
    return [
      {
        heading: fallbackHeading || "Guide",
        paragraphs: [],
      },
    ];
  }

  const sections = [];
  let currentHeading = fallbackHeading || "Guide";
  let paragraphBuffer = [];

  const flushParagraphs = () => {
    const paragraphs = paragraphBuffer
      .join("\n")
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (paragraphs.length || currentHeading) {
      sections.push({
        heading: currentHeading,
        paragraphs,
      });
    }
    paragraphBuffer = [];
  };

  normalized.split("\n").forEach((line) => {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (paragraphBuffer.length || sections.length) flushParagraphs();
      currentHeading = headingMatch[1].trim();
      return;
    }
    paragraphBuffer.push(line);
  });

  flushParagraphs();
  return sections.filter(
    (section) => section.heading || section.paragraphs.length > 0,
  );
};

const parseBlogFaq = (faqText) =>
  normalizeEnv(faqText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [question, ...answerParts] = line.split("|");
      return {
        question: normalizeEnv(question),
        answer: normalizeEnv(answerParts.join("|")),
      };
    })
    .filter((item) => item.question && item.answer);

const normalizeDbBlogPost = (post, locale) => {
  const postObject = typeof post.toObject === "function" ? post.toObject() : post;
  const title = getLocalizedField(postObject.title, locale);
  const excerpt = getLocalizedField(postObject.excerpt, locale);
  const metaTitle = getLocalizedField(postObject.metaTitle, locale) || `${title} | Kokoro Kimono`;
  const metaDescription = getLocalizedField(postObject.metaDescription, locale) || excerpt;

  return {
    slug: postObject.slug,
    title,
    metaTitle,
    metaDescription,
    excerpt,
    date: postObject.date || new Date(postObject.createdAt || Date.now()).toISOString().slice(0, 10),
    thumbnail: postObject.thumbnail || defaultSeoImage,
    thumbnailAlt:
      getLocalizedField(postObject.thumbnailAlt, locale) ||
      `${title} - Kokoro Kimono`,
    keywords: postObject.keywords || [],
    sections: (postObject.sections || []).map((section) => ({
      heading: getLocalizedField(section.heading, locale),
      paragraphs: (section.paragraphs || [])
        .map((paragraph) => getLocalizedField(paragraph, locale))
        .filter(Boolean),
    })),
    faq: (postObject.faq || []).map((item) => ({
      question: getLocalizedField(item.question, locale),
      answer: getLocalizedField(item.answer, locale),
    })),
  };
};

const getStaticBlogPosts = async (locale) => {
  const localizedPosts = [];

  for (const post of blogPosts) {
    const localizedPost = await localizeSeoObjectSegmented(
      `blog-post:${post.slug}`,
      locale,
      post,
    );
    localizedPosts.push(applyPostLocaleOverride(localizedPost, locale));
  }

  return localizedPosts;
};

const getPublicBlogPosts = async (locale) => {
  const staticPosts = await getStaticBlogPosts(locale);
  if (!isDbConnected()) return staticPosts;

  try {
    const dbPosts = await BlogPost.find({ isPublished: true })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const normalizedDbPosts = dbPosts.map((post) => normalizeDbBlogPost(post, locale));
    const dbSlugs = new Set(normalizedDbPosts.map((post) => post.slug));
    return [
      ...normalizedDbPosts,
      ...staticPosts.filter((post) => !dbSlugs.has(post.slug)),
    ];
  } catch (err) {
    console.error(JSON.stringify({ event: "request_error" }));
    return staticPosts;
  }
};

const getAdminBlogPosts = async () => {
  if (!isDbConnected()) return [];

  try {
    return await BlogPost.find().sort({ createdAt: -1 }).lean();
  } catch (err) {
    console.error(JSON.stringify({ event: "request_error" }));
    return [];
  }
};

// External services are configured here but connected only in start().
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dgpfqmncu",
  api_key: process.env.CLOUDINARY_API_KEY || "324438863362332",
  api_secret: process.env.CLOUDINARY_SECRET,
});

const normalizeEnv = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const BOOKING_STATUSES = BookingService.STATUSES;
const LEGACY_BOOKING_STATUS = "Đã đặt (Chờ đến)";
const ACTIVE_BOOKING_STATUSES = BookingService.ACTIVE;
const getTokyoDate = tokyoDate;
const getBookingGuestCount = BookingService.guestCount;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAdminBookingFilter = (query = {}) => {
  const filter =
    query.archived === "1" ? { archivedAt: { $ne: null } } : { archivedAt: null };
  const status = normalizeEnv(query.status);
  const date = normalizeEnv(query.date);
  const search = normalizeEnv(query.q).slice(0, 120);

  if (BOOKING_STATUSES.includes(status) || status === LEGACY_BOOKING_STATUS) {
    filter.status = status;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    filter.date = date;
  }

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { fullname: pattern },
      { email: pattern },
      { phone: pattern },
      { bookingCode: pattern },
    ];
  }

  return filter;
};

const adminRedirect = (notice, tab = "bookings") => {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  const query = params.toString();
  return `/admin${query ? `?${query}` : ""}#tab-${tab}`;
};

// --- CẤU HÌNH APP ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(",").map(s => s.trim()) : false);
app.use(...headers());
app.use(compression());
app.get("/health", (req, res) => res.status(isDbConnected() ? 200 : 503).json({ ok: isDbConnected() }));
app.use("/assets", express.static(path.join(__dirname, "public/assets"), { maxAge: "1y", immutable: true }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.use(express.urlencoded({ extended: true, limit: "100kb", parameterLimit: 200, depth: 3 }));
let sessionMiddleware;
app.use((req, res, next) => {
  if (!isDbConnected()) return next(new AppError(503, "service_unavailable"));
  if (!sessionMiddleware) {
    const store = MongoStore.create({ client: mongoose.connection.getClient(), dbName: mongoose.connection.name, ttl: 8 * 3600, touchAfter: 300 });
    store.on("error", () => console.error(JSON.stringify({ event: "session_store_error" })));
    app.locals.sessionStore = store;
    sessionMiddleware = session({
      name: "kokoro.sid", secret: process.env.SESSION_SECRET,
      store, resave: false, saveUninitialized: false,
      cookie: { maxAge: 8 * 3600000, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    });
  }
  sessionMiddleware(req, res, next);
});
app.use((req, res, next) => {
  const started = performance.now();
  res.on("finish", () => {
    if (res.statusCode >= 400 || performance.now() - started > 1000) {
      console.log(JSON.stringify({ event: "request", method: req.method, route: req.route?.path || "unknown", status: res.statusCode, ms: Math.round(performance.now() - started) }));
    }
  });
  next();
});

// Cấu hình i18n
i18n.configure({
  locales: ["vi", "en", "jp", "zh"],
  directory: __dirname + "/locales",
  defaultLocale: "en",
  cookie: "lang",
  queryParameter: "lang",
  objectNotation: true,
  autoReload: process.env.NODE_ENV === "development",
  updateFiles: false,
});

app.use(cookieParser());
app.use(i18n.init);

app.use((req, res, next) => {
  res.locals.siteUrl = siteUrl;
  res.locals.absoluteUrl = absoluteUrl;
  next();
});

// --- START: MIDDLEWARE ĐA NGÔN NGỮ & ĐỊNH DẠNG GIÁ ---
app.use((req, res, next) => {
  const supportedLocales = ["vi", "en", "jp", "zh"];
  const queryLang = req.query.lang;

  if (queryLang && supportedLocales.includes(queryLang)) {
    req.setLocale(queryLang);
    res.cookie("lang", queryLang, { maxAge: 90000000, httpOnly: true });
  } else if (req.cookies.lang && supportedLocales.includes(req.cookies.lang)) {
    req.setLocale(req.cookies.lang);
  }

  const currentLocale = req.getLocale();
  res.locals.locale = currentLocale;
  res.locals.ui = messages(currentLocale);
  res.locals.formCsrf = () => csrfToken(req);
  res.locals.languageSwitchUrl = lang => "/change-lang/" + encodeURIComponent(lang) + "?" + new URLSearchParams({ returnTo: req.originalUrl });

  // 1. Helper: Chuyển đổi và format giá tiền theo ngôn ngữ
  res.locals.formatPrice = (price) => {
    let priceJPY =
      typeof price === "string"
        ? parseInt(price.replace(/[^0-9]/g, "")) || 0
        : price;

    const rates = { vi: 165, en: 0.0067, jp: 1, zh: 0.048 };
    const formats = {
      vi: { symbol: " VNĐ", pos: "after", round: true },
      en: { symbol: "$", pos: "before", round: false },
      jp: { symbol: "¥", pos: "before", round: true },
      zh: { symbol: "¥", pos: "before", round: false },
    };

    const format = formats[currentLocale] || formats.jp;
    let converted = priceJPY * (rates[currentLocale] || 1);

    if (format.round) {
      converted =
        currentLocale === "vi"
          ? Math.round(converted / 1000) * 1000
          : Math.round(converted);
      converted = converted.toLocaleString(
        currentLocale === "vi" ? "vi-VN" : "ja-JP",
      );
    } else {
      converted = converted.toFixed(2);
    }

    return format.pos === "before"
      ? format.symbol + converted
      : converted + format.symbol;
  };

  // 2. Helper: Lấy text đa ngôn ngữ an toàn
  res.locals.getLocalizedText = (field) => {
    if (!field) return "";
    if (typeof field === "string") return res.__(field);
    return field[currentLocale] || field.en || field.vi || "";
  };

  next();
});
// --- END: MIDDLEWARE ĐA NGÔN NGỮ & ĐỊNH DẠNG GIÁ ---

// Middleware Bảo vệ Admin
const requireLogin = (req, res, next) => {
  if (req.session?.isAdmin) {
    res.set("Cache-Control", "no-store");
    next();
  } else {
    res.redirect("/login");
  }
};

const getAdminCsrfToken = (req) => {
  if (!req.session.adminCsrfToken) {
    req.session.adminCsrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.adminCsrfToken;
};

// --- ROUTES ---

// 1. Trang chủ
// Tìm route trang chủ và sửa đoạn lấy heroConfig:
app.get("/", async (req, res) => {
  const locale = getSeoLocale(req);
  const seoText = getSeoLabels(locale);
  const localizedLandingPageRaw = await localizeSeoObject(
    "landingPage",
    locale,
    landingPage,
  );
  const localizedLandingPage = {
    ...localizedLandingPageRaw,
    title: seoText.landingTitle,
    metaTitle: seoText.landingTitle,
    metaDescription: seoText.landingMetaDescription,
  };
  const [dbPlans, heroImages, publicBlogPosts] = await Promise.all([getVisiblePlans(), getHeroImages(), getPublicBlogPosts(locale)]);
  const seo = buildSeo({
    title: seoText.landingTitle,
    description: seoText.landingMetaDescription,
    path: "/",
    image: heroImages[0] || defaultSeoImage,
    locale,
  });

  res.render("index", {
    plans: dbPlans,
    shops: shops,
    galleryImages: galleryImages,
    heroImages: heroImages, // 👈 Truyền biến số nhiều (Array) sang View
    featuredPosts: publicBlogPosts.slice(0, 3),
    seoText,
    seo,
    structuredData: [
      buildLocalBusinessSchema(),
      buildBreadcrumbSchema([{ name: seoText.home, path: "/" }]),
      buildFaqSchema(localizedLandingPage.faq),
    ],
    pageTitle: seo.title,
  });
});

app.get("/kimono-rental-kyoto", async (req, res) => {
  const locale = getSeoLocale(req);
  const seoText = getSeoLabels(locale);
  const localizedLandingPageRaw = await localizeSeoObject(
    "landingPage",
    locale,
    landingPage,
  );
  const localizedLandingPage = {
    ...localizedLandingPageRaw,
    title: seoText.landingTitle,
    metaTitle: seoText.landingTitle,
    metaDescription: seoText.landingMetaDescription,
  };
  const publicBlogPosts = await getPublicBlogPosts(locale);
  const seo = buildSeo({
    title: localizedLandingPage.metaTitle,
    description: localizedLandingPage.metaDescription,
    path: localizedLandingPage.path,
    image: localizedLandingPage.heroImage,
    locale,
  });

  res.render("kimono-rental-kyoto", {
    page: localizedLandingPage,
    rentalPlans: await localizeSeoObject("rentalPlans", locale, rentalPlans),
    blogPosts: publicBlogPosts.slice(0, 3),
    seoText,
    seo,
    structuredData: [
      buildLocalBusinessSchema(),
      buildFaqSchema(localizedLandingPage.faq),
      buildBreadcrumbSchema([
        { name: seoText.home, path: "/" },
        { name: seoText.navRental, path: localizedLandingPage.path },
      ]),
    ],
    pageTitle: seo.title,
  });
});

app.get("/kimono-photoshoot-kyoto", async (req, res) => {
  const locale = getSeoLocale(req);
  const seoText = getSeoLabels(locale);
  const localizedPhotoshootPageRaw = await localizeSeoObject(
    "photoshootPage",
    locale,
    photoshootPage,
  );
  const localizedPhotoshootPage = {
    ...localizedPhotoshootPageRaw,
    title: seoText.photoshootTitle,
    metaTitle: seoText.photoshootTitle,
    metaDescription: seoText.photoshootMetaDescription,
  };
  const seo = buildSeo({
    title: localizedPhotoshootPage.metaTitle,
    description: localizedPhotoshootPage.metaDescription,
    path: localizedPhotoshootPage.path,
    image: localizedPhotoshootPage.heroImage,
    locale,
  });

  res.render("kimono-photoshoot-kyoto", {
    page: localizedPhotoshootPage,
    seoText,
    seo,
    structuredData: [
      buildLocalBusinessSchema(),
      buildFaqSchema(localizedPhotoshootPage.faq),
      buildBreadcrumbSchema([
        { name: seoText.home, path: "/" },
        { name: seoText.navPhotoshoot, path: localizedPhotoshootPage.path },
      ]),
    ],
    pageTitle: seo.title,
  });
});

app.get("/blog", async (req, res) => {
  const locale = getSeoLocale(req);
  const seoText = getSeoLabels(locale);
  const publicBlogPosts = await getPublicBlogPosts(locale);
  const seo = buildSeo({
    title: seoText.blogMetaTitle,
    description: seoText.blogMetaDescription,
    path: "/blog",
    image: defaultSeoImage,
    locale,
  });

  res.render("blog", {
    posts: publicBlogPosts,
    seoText,
    seo,
    structuredData: [
      buildBreadcrumbSchema([
        { name: seoText.home, path: "/" },
        { name: seoText.navBlog, path: "/blog" },
      ]),
    ],
    pageTitle: seo.title,
  });
});

app.get("/blog/:slug", async (req, res) => {
  const locale = getSeoLocale(req);
  const seoText = getSeoLabels(locale);
  const publicBlogPosts = await getPublicBlogPosts(locale);
  const post = publicBlogPosts.find((item) => item.slug === req.params.slug);
  if (!post) return res.status(404).send("Blog post not found");
  const relatedPosts = publicBlogPosts
    .filter((item) => item.slug !== post.slug)
    .slice(0, 3);

  const seo = buildSeo({
    title: post.metaTitle,
    description: post.metaDescription,
    path: `/blog/${post.slug}`,
    image: post.thumbnail,
    type: "article",
    locale,
  });

  res.render("blog-post", {
    post,
    relatedPosts,
    seoText,
    seo,
    structuredData: [
      buildArticleSchema(post),
      buildFaqSchema(post.faq),
      buildBreadcrumbSchema([
        { name: seoText.home, path: "/" },
        { name: seoText.navBlog, path: "/blog" },
        { name: post.title, path: `/blog/${post.slug}` },
      ]),
    ],
    pageTitle: seo.title,
  });
});

app.get("/sitemap.xml", async (req, res) => {
  const publicBlogPosts = await getPublicBlogPosts("en");
  const urls = [
    { loc: "/", priority: "1.0", changefreq: "weekly" },
    { loc: "/kimono-rental-kyoto", priority: "0.95", changefreq: "monthly" },
    { loc: "/kimono-photoshoot-kyoto", priority: "0.85", changefreq: "monthly" },
    { loc: "/blog", priority: "0.8", changefreq: "weekly" },
    ...publicBlogPosts.map((post) => ({
      loc: `/blog/${post.slug}`,
      priority: "0.75",
      changefreq: "monthly",
      lastmod: post.date,
    })),
  ];

  const languageVariants = ["", "?lang=vi", "?lang=jp", "?lang=zh"];
  const urlXml = urls
    .flatMap((url) =>
      languageVariants.map((suffix) => ({
        ...url,
        loc: `${url.loc}${suffix}`,
      })),
    )
    .map(
      (url) => `  <url>
    <loc>${absoluteUrl(url.loc)}</loc>
    <lastmod>${url.lastmod || "2026-04-29"}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`,
    )
    .join("\n");

  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlXml}
</urlset>`);
});

// API Đổi ngôn ngữ
app.get("/change-lang/:lang", (req, res) => {
  const lang = req.params.lang;
  if (!["vi", "en", "jp", "zh"].includes(lang)) throw new AppError(400, "invalid_request");
  res.cookie("lang", lang, { maxAge: 90000000, httpOnly: true, sameSite: "lax" });
  const target = languageReturnPath(req.query.returnTo, req.get("Referrer"), siteUrl);
  res.set("Cache-Control", "no-store").redirect(302, target);
});

require("./routes/bookings").registerBookingRoutes(app, { getVisiblePlans });
require("./routes/auth").registerAuthRoutes(app);

app.get("/admin", requireLogin, async (req, res) => {
  try {
    const today = getTokyoDate();
    const monthStart = `${today.slice(0, 7)}-01`;
    const bookingFilter = getAdminBookingFilter(req.query);
    const requestedPage = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 10000);
    const bookingPageSize = 50;
    const activeFilter = {
      archivedAt: null,
      status: { $in: ACTIVE_BOOKING_STATUSES },
    };
    const pendingFilter = {
      ...activeFilter,
      date: { $gte: today },
      status: { $in: ["Mới", LEGACY_BOOKING_STATUS] },
    };

    const [
      bookings,
      bookingCount,
      plans,
      heroConfig,
      blogs,
      todayBookings,
      upcomingBookings,
      pendingCount,
      monthBookings,
      backgroundJobs,
    ] = await Promise.all([
      Booking.find(bookingFilter)
        .sort({ date: 1, time: 1, createdAt: -1 })
        .skip((requestedPage - 1) * bookingPageSize)
        .limit(bookingPageSize)
        .lean(),
      Booking.countDocuments(bookingFilter),
      Plan.find().lean(),
      Config.findOne({ key: "hero_image" }).lean(),
      getAdminBlogPosts(),
      Booking.find({ archivedAt: null, date: today })
        .sort({ time: 1, createdAt: 1 })
        .lean(),
      Booking.find({ ...activeFilter, date: { $gte: today } })
        .sort({ date: 1, time: 1 })
        .limit(8)
        .lean(),
      Booking.countDocuments(pendingFilter),
      Booking.aggregate([{ $match: { ...activeFilter, date: { $gte: monthStart, $lte: today } } }, { $group: { _id: null, total: { $sum: "$totalPrice" } } }]),
      Job.find({ status: { $in: ["pending", "running", "failed"] } }).select("type status attempts lastError updatedAt").sort({ updatedAt: -1 }).limit(20).lean(),
    ]);

    const todayActiveBookings = todayBookings.filter((booking) =>
      ACTIVE_BOOKING_STATUSES.includes(booking.status),
    );
    const todayGuests = todayActiveBookings.reduce(
      (total, booking) => total + getBookingGuestCount(booking),
      0,
    );
    const monthRevenue = monthBookings[0]?.total || 0;

    const bookingDetails = new Map();
    [...bookings, ...todayBookings, ...upcomingBookings].forEach((booking) => {
      bookingDetails.set(String(booking._id), {
        id: String(booking._id),
        bookingCode: booking.bookingCode || `KK-${String(booking._id).slice(-6).toUpperCase()}`,
        fullname: booking.fullname || "Khách chưa có tên",
        email: booking.email || "",
        phone: booking.phone || "",
        shopName: booking.shopName || "Kokoro Kimono Rental",
        date: booking.date || "",
        time: booking.time || "",
        totalPrice: Number(booking.totalPrice) || 0,
        status: booking.status || "Mới",
        language: booking.language || "",
        guests: booking.guests || [],
        statusHistory: booking.statusHistory || [],
        notes: booking.notes || [],
        archivedAt: booking.archivedAt || null,
        createdAt: booking.createdAt || null,
      });
    });

    const hasBookingFilters = Boolean(
      normalizeEnv(req.query.q) ||
        normalizeEnv(req.query.status) ||
        normalizeEnv(req.query.date) ||
        req.query.archived === "1" ||
        requestedPage > 1,
    );
    const totalBookingPages = Math.max(
      1,
      Math.ceil(bookingCount / bookingPageSize),
    );
    const buildBookingPageUrl = (page) => {
      const params = new URLSearchParams();
      if (normalizeEnv(req.query.q)) params.set("q", normalizeEnv(req.query.q));
      if (normalizeEnv(req.query.status)) params.set("status", normalizeEnv(req.query.status));
      if (normalizeEnv(req.query.date)) params.set("date", normalizeEnv(req.query.date));
      if (req.query.archived === "1") params.set("archived", "1");
      params.set("page", String(page));
      return `/admin?${params.toString()}#tab-bookings`;
    };

    res.render("admin", {
      bookings,
      backgroundJobs,
      plans,
      blogs,
      heroImage: heroConfig ? heroConfig.value : "",
      pageTitle: "Kokoro Operations",
      bookingStatuses: BOOKING_STATUSES,
      bookingDataJson: escapeJsonForHtml([...bookingDetails.values()]),
      bookingStatusesJson: escapeJsonForHtml(BOOKING_STATUSES),
      dashboard: {
        today,
        todayBookings,
        upcomingBookings,
        todayGuests,
        pendingCount,
        monthRevenue,
        activeTodayCount: todayActiveBookings.length,
      },
      filters: {
        q: normalizeEnv(req.query.q),
        status: normalizeEnv(req.query.status),
        date: normalizeEnv(req.query.date),
        archived: req.query.archived === "1",
      },
      notice: normalizeEnv(req.query.notice),
      defaultAdminTab: hasBookingFilters ? "bookings" : "dashboard",
      pagination: {
        page: requestedPage,
        totalPages: totalBookingPages,
        totalItems: bookingCount,
        previousUrl:
          requestedPage > 1 ? buildBookingPageUrl(requestedPage - 1) : "",
        nextUrl:
          requestedPage < totalBookingPages
            ? buildBookingPageUrl(requestedPage + 1)
            : "",
      },
      csrfToken: getAdminCsrfToken(req),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "request_error" }));
    res.status(500).send("Không thể tải trang quản trị.");
  }
});

// Xử lý Lưu/Sửa Gói (CÓ UPLOAD ẢNH)
// Xử lý Lưu/Sửa Gói (CÓ UPLOAD ẢNH)
app.post(
  "/admin/plan/save",
  requireLogin,
  rateLimit("admin-upload", 20, 600000),
  manageUploads,
  upload.array("photos", 10),
  requireAdminCsrf,
  publishUploads,
  async (req, res) => {
    try {
      const {
        id,
        title,
        price,
        originalPrice,
        desc,
        tag,
        isVisible,
        image: oldImage,
        imagesString,
      } = req.body;

      let images = [];
      if (req.files && req.files.length > 0) {
        images = req.files.map((file) => file.path);
      } else if (imagesString) {
        images = imagesString
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
      }

      images = images.map(safeImageUrl).filter(Boolean);
      const mainImage = images.length > 0 ? images[0] : safeImageUrl(oldImage);

      // 👇 CẬP NHẬT: Dịch cả Tiêu đề (title) và Mô tả (desc)
      const sourceLocale = req.getLocale();
      const cleanTitle = text(title, "title", 200);
      const cleanDesc = text(desc, "description", 10000, false);
      const multiLangTitle = initialText(cleanTitle, sourceLocale);
      const multiLangDesc = initialText(cleanDesc, sourceLocale);

      const planData = {
        title: multiLangTitle, // Lưu title dưới dạng Object đa ngôn ngữ
        price: integer(price, "price", 0, 10000000),
        originalPrice: originalPrice ? integer(originalPrice, "price", 0, 10000000) : undefined,
        image: mainImage,
        images: images,
        desc: multiLangDesc,
        tag,
        isVisible: isVisible === "on",
      };

      await mongoose.connection.transaction(async session => {
        let saved;
        if (id) {
          if (!mongoose.isObjectIdOrHexString(id)) throw new AppError(400, "invalid_plan");
          if (images.length === 0) { delete planData.images; delete planData.image; }
          saved = await Plan.findByIdAndUpdate(id, { $set: planData, $inc: { translationVersion: 1 } }, { returnDocument: "after", runValidators: true, session });
          if (!saved) throw new AppError(404, "not_found");
        } else {
          if (!planData.image) planData.image = "/img/gallery/1.jpg";
          [saved] = await Plan.create([{ ...planData, translationVersion: 1 }], { session });
        }
        await Job.create([{ key: "translate:plan:" + saved._id + ":" + saved.translationVersion, type: "translation",
          payload: { model: "Plan", id: String(saved._id), version: saved.translationVersion, locale: sourceLocale, source: { title: multiLangTitle, desc: multiLangDesc } } }], { session });
      });

      res.redirect(adminRedirect("plan-saved", "plans"));
    } catch (err) {
      console.error(JSON.stringify({ event: "request_error", ...safeErrorDetails(err) }));
      res.status(err.status || 500).send("Không thể xử lý yêu cầu.");
    }
  },
);

app.post("/admin/plan/delete/:id", requireLogin, requireAdminCsrf, async (req, res) => {
  try {
    await Plan.findByIdAndDelete(req.params.id);
    res.redirect(adminRedirect("plan-deleted", "plans"));
  } catch (error) {
    console.error(JSON.stringify({ event: "request_error" }));
    res.redirect(adminRedirect("plan-delete-failed", "plans"));
  }
});

app.post(
  "/admin/blog/save",
  requireLogin,
  rateLimit("admin-upload", 20, 600000),
  manageUploads,
  upload.single("thumbnail_file"),
  requireAdminCsrf,
  publishUploads,
  async (req, res) => {
    try {
      const {
        title,
        slug,
        excerpt,
        keywords,
        content,
        faq,
        date,
        thumbnail,
      } = req.body;

      const cleanTitle = text(title, "title", 200);
      const cleanExcerpt = text(excerpt, "excerpt", 1000);
      const cleanContent = text(content, "content", 40000);

      if (!cleanTitle || !cleanExcerpt || !cleanContent) {
        return res.status(400).send("Thiếu tiêu đề, mô tả ngắn hoặc nội dung blog.");
      }

      const finalSlug = await ensureUniqueBlogSlug(slug || cleanTitle);
      const finalThumbnail = req.file?.path || safeImageUrl(thumbnail) || defaultSeoImage;
      const parsedSections = parseBlogSections(cleanContent, cleanTitle);
      const parsedFaq = parseBlogFaq(faq);
      const keywordList = normalizeEnv(keywords)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const sourceLocale = req.getLocale();
      const translatedTitle = initialText(cleanTitle, sourceLocale);
      const translatedExcerpt = initialText(cleanExcerpt, sourceLocale);
      const translatedSections = parsedSections.map(s => ({ heading: initialText(s.heading, sourceLocale), paragraphs: s.paragraphs.map(p => initialText(p, sourceLocale)) }));
      const translatedFaq = parsedFaq.map(f => ({ question: initialText(f.question, sourceLocale), answer: initialText(f.answer, sourceLocale) }));
      const translatedMetaTitle = Object.fromEntries(
        Object.entries(translatedTitle).map(([lang, value]) => [
          lang,
          value ? `${value} | Kokoro Kimono` : "",
        ]),
      );

      const blogData = {
        slug: finalSlug,
        title: translatedTitle,
        metaTitle: translatedMetaTitle,
        metaDescription: translatedExcerpt,
        excerpt: translatedExcerpt,
        thumbnail: finalThumbnail,
        thumbnailAlt: translatedTitle,
        keywords: keywordList,
        sections: translatedSections,
        faq: translatedFaq,
        date: validDate(date) ? date : tokyoDate(),
        translationVersion: 1,
        isPublished: req.body.isPublished === "on",
      };

      await mongoose.connection.transaction(async session => {
        const [saved] = await BlogPost.create([blogData], { session });
        const source = Object.fromEntries(["title", "metaTitle", "metaDescription", "excerpt", "thumbnailAlt", "sections", "faq"].map(k => [k, blogData[k]]));
        await Job.create([{ key: "translate:blog:" + saved._id + ":1", type: "translation", payload: { model: "BlogPost", id: String(saved._id), version: 1, locale: sourceLocale, source } }], { session });
      });
      res.redirect(adminRedirect("blog-saved", "content"));
    } catch (err) {
      console.error(JSON.stringify({ event: "request_error" }));
      res.status(err.status || 500).send("Không thể xử lý yêu cầu.");
    }
  },
);

app.post("/admin/blog/delete/:id", requireLogin, requireAdminCsrf, async (req, res) => {
  try {
    await BlogPost.findByIdAndDelete(req.params.id);
    res.redirect(adminRedirect("blog-deleted", "content"));
  } catch (error) {
    console.error(JSON.stringify({ event: "request_error" }));
    res.redirect(adminRedirect("blog-delete-failed", "content"));
  }
});

// 👇 ROUTE XỬ LÝ CẤU HÌNH (Thay ảnh Hero) - Đã nâng cấp Upload Cloudinary
// 👇 SỬA ROUTE NÀY: Dùng upload.array để nhận nhiều ảnh (tối đa 5 ảnh)
app.post(
  "/admin/config/save",
  requireLogin,
  rateLimit("admin-upload", 20, 600000),
  manageUploads,
  upload.array("hero_photos", 5),
  requireAdminCsrf,
  publishUploads,
  async (req, res) => {
    try {
      // 1. Lấy danh sách ảnh cũ (đang hiển thị)
      // Nếu user không xóa ảnh cũ, nó sẽ gửi lên dạng input hidden
      let currentImages = req.body.hero_images_old || [];
      if (!Array.isArray(currentImages)) {
        currentImages = [currentImages]; // Ép về mảng nếu chỉ có 1 ảnh
      }
      // Lọc bỏ các giá trị rỗng/undefined
      currentImages = currentImages.map(safeImageUrl).filter(Boolean);

      // 2. Lấy danh sách ảnh MỚI vừa upload lên Cloudinary
      let newImages = [];
      if (req.files && req.files.length > 0) {
        newImages = req.files.map((file) => file.path);
      }

      // 3. Gộp ảnh cũ + ảnh mới
      const finalImages = [...currentImages, ...newImages];
      if (finalImages.length > 5) throw new AppError(400, "invalid_images");

      // 4. Lưu vào Database (Lưu đè value bằng mảng mới)
      await Config.findOneAndUpdate(
        { key: "hero_image" },
        { value: finalImages }, // Mongoose sẽ tự lưu mảng này
        { upsert: true },
      );

      res.redirect(adminRedirect("settings-saved", "content"));
    } catch (err) {
      console.error(JSON.stringify({ event: "request_error" }));
      res.status(err.status || 500).send("Không thể xử lý yêu cầu.");
    }
  },
);

app.post("/admin/update/:id", requireLogin, requireAdminCsrf, async (req, res) => {
  try {
    const status = normalizeEnv(req.body.status);
    const note = normalizeEnv(req.body.note).slice(0, 1000);
    if (!BOOKING_STATUSES.includes(status)) {
      return res.redirect(adminRedirect("invalid-status", "bookings"));
    }

    await BookingService.updateBooking(req.params.id, { status, note });
    res.redirect(adminRedirect("booking-updated", "bookings"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(JSON.stringify({ event: "request_error" }));
    res.redirect(adminRedirect("booking-update-failed", "bookings"));
  }
});

app.post("/admin/booking/:id/note", requireLogin, requireAdminCsrf, async (req, res) => {
  try {
    const content = normalizeEnv(req.body.note).slice(0, 1000);
    if (!content) return res.redirect(adminRedirect("note-empty", "bookings"));

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.redirect(adminRedirect("booking-not-found", "bookings"));

    booking.notes.push({ content, createdBy: "Admin" });
    await booking.save();
    res.redirect(adminRedirect("note-saved", "bookings"));
  } catch (error) {
    console.error(JSON.stringify({ event: "request_error" }));
    res.redirect(adminRedirect("note-save-failed", "bookings"));
  }
});

app.post("/admin/delete/:id", requireLogin, requireAdminCsrf, async (req, res) => {
  try {
    await BookingService.updateBooking(req.params.id, { archive: true });
    res.redirect(adminRedirect("booking-archived", "bookings"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(JSON.stringify({ event: "request_error" }));
    res.redirect(adminRedirect("booking-archive-failed", "bookings"));
  }
});

app.post("/admin/booking/:id/restore", requireLogin, requireAdminCsrf, async (req, res) => {
  try {
    await BookingService.updateBooking(req.params.id, { archive: false });
    res.redirect(adminRedirect("booking-restored", "bookings"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(JSON.stringify({ event: "request_error" }));
    res.redirect(adminRedirect("booking-restore-failed", "bookings"));
  }
});


app.post("/admin/jobs/:id/retry", requireLogin, requireAdminCsrf, async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new AppError(400, "invalid_job");
  await Job.updateOne({ _id: req.params.id, status: "failed" }, { $set: { status: "pending", attempts: 0, availableAt: new Date() }, $unset: { lastError: 1, lockToken: 1, lockedUntil: 1 } });
  res.redirect(303, "/admin");
});

app.use((req, res, next) => next(new AppError(404, "not_found")));
app.use((error, req, res, next) => {
  error = normalizeUploadError(error);
  if (res.headersSent) return next(error);
  const status = error.status || (error.name === "MulterError" ? 400 : error.name === "ValidationError" || error.name === "CastError" ? 400 : 503);
  const code = error instanceof AppError ? error.code : status === 400 ? "invalid_request" : "service_unavailable";
  const language = typeof req.getLocale === "function" ? req.getLocale() : "en";
  const message = errorMessage(code, language);
  console.error(JSON.stringify({ event: "request_error", code, status, route: req.route?.path || "unknown", ...safeErrorDetails(error) }));
  res.set("Cache-Control", "no-store");
  if (req.path.startsWith("/api/")) return res.status(status).json({ error: message, code });
  res.status(status).render("error", { message, ui: messages(language), locale: language, asset, backUrl: req.path.startsWith("/admin/") ? "/admin#tab-plans" : "/booking-step1" });
});
async function start() {
  validateConfig();
  assertAssetsBuilt();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([Booking.init(), Plan.init(), BlogPost.init(), Config.init(), Job.init(), require("./models/SlotInventory").init(), require("./models/RateBucket").init()]);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("MongoDB transactions require a replica set.");
  const stopWorker = process.env.WORKER_ENABLED === "false" ? async () => {} : require("./services/jobs").startWorker();
  const server = app.listen(process.env.PORT || 3000, () => console.log("Kokoro server listening."));
  async function stop() { server.close(); await stopWorker(); await mongoose.disconnect(); }
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  return { server, stop };
}
if (require.main === module) start().catch(error => {
  console.error("Startup failed:", /^(Missing configuration|Use a session|TRUST_PROXY|Production requires|SITE_URL|MongoDB transactions|Assets are missing)/.test(error.message) ? error.message : "Check service configuration and database connectivity.");
  process.exitCode = 1;
  mongoose.disconnect().catch(() => {});
});
module.exports = { app, start };
