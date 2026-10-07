export type Language = "ar" | "en";

export type ColorKey = "purple" | "blue" | "yellow";

export type Category = {
  id: string;
  number: string;
  name: Record<Language, string>;
  color: ColorKey;
};

// Seed data for demo (mock) mode. With VITE_API_URL set, categories and makers come from GET /catalog instead.
export const categories: Category[] = [
  {
    id: "one",
    number: "01",
    name: { ar: "الفئة الأولى", en: "Category One" },
    color: "purple",
  },
  {
    id: "two",
    number: "02",
    name: { ar: "الفئة الثانية", en: "Category Two" },
    color: "blue",
  },
  {
    id: "three",
    number: "03",
    name: { ar: "الفئة الثالثة", en: "Category Three" },
    color: "yellow",
  },
];

export type Maker = {
  id: string;
  categoryId: string;
  team: Record<Language, string>;
  members?: Record<Language, string>[];
  title: Record<Language, string>;
  short: Record<Language, string>;
  long: Record<Language, string>;
  image: string;
  imageAlt: Record<Language, string>;
};

const photos = [
  "https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1599584933236-b93d637a8630?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1723074832961-397744da2380?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1586868538513-51335a0c5337?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1596495717678-69df9f89c2a3?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1669225313299-dcae29b817e8?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1596496050756-93ba991aae15?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1596495717749-f6562c785fda?auto=format&fit=crop&w=900&q=82",
  "https://images.unsplash.com/photo-1755053757912-a63da9d6e0e2?auto=format&fit=crop&w=900&q=82",
];

export const makers: Maker[] = [
  {
    id: "m1",
    categoryId: "one",
    team: { ar: "فريق مدى", en: "MADA LAB" },
    members: [
      { ar: "ليان أحمد", en: "Layan Ahmad" },
      { ar: "عمر خالد", en: "Omar Khaled" },
      { ar: "سارة محمود", en: "Sara Mahmoud" },
    ],
    title: { ar: "عين الصحراء", en: "Desert Eye" },
    short: {
      ar: "نظام ذكي منخفض الطاقة لمراقبة صحة التربة.",
      en: "A low-energy system that monitors soil health.",
    },
    long: {
      ar: "شبكة حساسات مصنوعة محلياً تقيس رطوبة التربة وملوحتها، ثم ترسل تنبيهات واضحة للمزارع حتى يستخدم الماء في الوقت والمكان المناسبين.",
      en: "A locally built sensor network measures soil moisture and salinity, then gives growers simple alerts so water is used exactly where and when it is needed.",
    },
    image: photos[0],
    imageAlt: { ar: "مهندسة تفحص مخططاً تقنياً", en: "Engineer reviewing a technical drawing" },
  },
  {
    id: "m2",
    categoryId: "one",
    team: { ar: "استوديو نواة", en: "NAWA STUDIO" },
    members: [
      { ar: "نور حسن", en: "Noor Hassan" },
      { ar: "يزن علي", en: "Yazan Ali" },
    ],
    title: { ar: "سماع", en: "Samaa" },
    short: {
      ar: "سماعة قابلة للإصلاح صممت لتدوم طويلاً.",
      en: "Repairable headphones designed for a longer life.",
    },
    long: {
      ar: "سماعة معيارية يمكن تبديل كل جزء فيها بأداة واحدة. يقلل التصميم النفايات الإلكترونية ويجعل الإصلاح المحلي بسيطاً ومتاحاً.",
      en: "A modular headset where every part can be replaced with one tool. The design reduces e-waste and makes local repair simple and affordable.",
    },
    image: photos[1],
    imageAlt: { ar: "صانعة تحمل نموذج سماعة", en: "Maker holding a headphone prototype" },
  },
  {
    id: "m3",
    categoryId: "one",
    team: { ar: "مختبر لبنة", en: "LABNA LAB" },
    members: [
      { ar: "تالا يوسف", en: "Tala Yousef" },
      { ar: "آدم سامر", en: "Adam Samer" },
      { ar: "رنا إبراهيم", en: "Rana Ibrahim" },
    ],
    title: { ar: "بُنى", en: "Buna" },
    short: {
      ar: "قطع بناء تعليمية من البلاستيك المعاد تدويره.",
      en: "Learning blocks made from recycled plastic.",
    },
    long: {
      ar: "منظومة لعب مفتوحة تحول مخلفات البلاستيك المحلية إلى قطع تركيب آمنة، وتساعد الأطفال على تعلم مبادئ الهندسة من خلال التجربة.",
      en: "An open-ended play system turns local plastic waste into safe construction pieces and helps children explore engineering through making.",
    },
    image: photos[2],
    imageAlt: { ar: "قطع بناء ملونة على طاولة", en: "Colorful building pieces on a workbench" },
  },
  {
    id: "m4",
    categoryId: "two",
    team: { ar: "ورشة فولت", en: "VOLT WORKSHOP" },
    members: [
      { ar: "زيد أحمد", en: "Zaid Ahmad" },
      { ar: "دانا عمر", en: "Dana Omar" },
      { ar: "كريم نبيل", en: "Kareem Nabil" },
    ],
    title: { ar: "مسار", en: "Masar" },
    short: {
      ar: "وحدة تحويل كهربائية للمركبات الخفيفة.",
      en: "An electric conversion kit for light vehicles.",
    },
    long: {
      ar: "وحدة مرنة تحول الدراجات والمركبات الخفيفة القديمة إلى حلول تنقل كهربائية، مع بطارية قابلة للصيانة ونظام تحكم آمن.",
      en: "A flexible kit converts older bikes and light vehicles into electric mobility, with a serviceable battery and a safety-first controller.",
    },
    image: photos[3],
    imageAlt: { ar: "صانع يعمل على نموذج كهربائي", en: "Maker working on an electric prototype" },
  },
  {
    id: "m5",
    categoryId: "two",
    team: { ar: "هندسة قريبة", en: "NEAR ENGINEERING" },
    members: [
      { ar: "هيا خالد", en: "Haya Khaled" },
      { ar: "سيف محمود", en: "Saif Mahmoud" },
    ],
    title: { ar: "دليل", en: "Daleel" },
    short: {
      ar: "أداة لمسية تساعد ضعاف البصر على التنقل.",
      en: "A haptic guide for people with low vision.",
    },
    long: {
      ar: "جهاز صغير يترجم اتجاهات الهاتف إلى نبضات لمسية واضحة، ليساعد المستخدم على المشي بثقة دون الحاجة إلى متابعة الشاشة.",
      en: "A compact device translates phone directions into clear haptic signals, helping users walk confidently without constantly checking a screen.",
    },
    image: photos[4],
    imageAlt: { ar: "صانع يختبر جهازاً محمولاً", en: "Maker testing a handheld device" },
  },
  {
    id: "m6",
    categoryId: "two",
    team: { ar: "سينابس", en: "SYNAPSE" },
    members: [
      { ar: "جود علي", en: "Joud Ali" },
      { ar: "راشد حسن", en: "Rashed Hassan" },
      { ar: "لين يوسف", en: "Leen Yousef" },
    ],
    title: { ar: "نبض", en: "Nabd" },
    short: {
      ar: "لوحة تعلم إلكترونيات تتطور مع مهارة الطالب.",
      en: "An electronics board that grows with the learner.",
    },
    long: {
      ar: "منصة إلكترونية عربية تبدأ بتجارب بسيطة ثم تفتح وحدات أكثر تقدماً، وتربط كل تجربة بمشكلة حقيقية من المجتمع.",
      en: "An Arabic-first electronics platform starts with simple experiments, unlocks advanced modules, and links every lesson to a real community problem.",
    },
    image: photos[5],
    imageAlt: { ar: "يدان تعملان على لوحة إلكترونية", en: "Hands assembling a circuit board" },
  },
  {
    id: "m7",
    categoryId: "three",
    team: { ar: "جمعية أثر", en: "ATHAR COLLECTIVE" },
    members: [
      { ar: "سلمى إبراهيم", en: "Salma Ibrahim" },
      { ar: "مروان أحمد", en: "Marwan Ahmad" },
    ],
    title: { ar: "حكاية مكان", en: "Place Stories" },
    short: {
      ar: "أرشيف صوتي تفاعلي لحكايات الأحياء.",
      en: "An interactive audio archive of neighborhood stories.",
    },
    long: {
      ar: "منصة مجتمعية تحفظ الذاكرة الشفوية للأحياء الأردنية عبر تسجيلات قصيرة يمكن اكتشافها أثناء المشي باستخدام الهاتف.",
      en: "A community platform preserves oral histories from Jordanian neighborhoods in short recordings discovered on location with a phone.",
    },
    image: photos[6],
    imageAlt: { ar: "شاب يسجل قصة باستخدام هاتف", en: "Young maker recording a story by phone" },
  },
  {
    id: "m8",
    categoryId: "three",
    team: { ar: "دائرة خضراء", en: "GREEN LOOP" },
    members: [
      { ar: "ريم خالد", en: "Reem Khaled" },
      { ar: "أنس عمر", en: "Anas Omar" },
      { ar: "فرح نبيل", en: "Farah Nabil" },
    ],
    title: { ar: "نقطة ماء", en: "Water Point" },
    short: {
      ar: "محطة عامة ذكية لإعادة تعبئة المياه.",
      en: "A smart public station for water refills.",
    },
    long: {
      ar: "محطة تعبئة متينة تشجع استخدام العبوات المتكررة، وتعرض أثر كل حي في تقليل البلاستيك بطريقة بسيطة ومحفزة.",
      en: "A durable refill station encourages reusable bottles and shows each neighborhood's plastic reduction impact in a simple, motivating way.",
    },
    image: photos[7],
    imageAlt: { ar: "طالب يعرض نموذجاً أولياً", en: "Student presenting a physical prototype" },
  },
  {
    id: "m9",
    categoryId: "three",
    team: { ar: "صُنّاع معاً", en: "MAKERS TOGETHER" },
    members: [
      { ar: "باسل محمود", en: "Basel Mahmoud" },
      { ar: "لما حسن", en: "Lama Hassan" },
      { ar: "محمد سامر", en: "Mohammad Samer" },
    ],
    title: { ar: "منضدة", en: "Workbench" },
    short: {
      ar: "ورشة متنقلة تصل إلى المدارس البعيدة.",
      en: "A mobile workshop for schools beyond the city.",
    },
    long: {
      ar: "وحدة تعليم متنقلة تحمل أدوات تصنيع آمنة ومناهج عملية، وتمنح الطلبة فرصة تصميم حلول لمشكلات منطقتهم.",
      en: "A mobile learning unit carries safe fabrication tools and hands-on lessons, giving students the chance to design for local challenges.",
    },
    image: photos[8],
    imageAlt: { ar: "مجموعة تعمل معاً حول طاولة", en: "A group making together around a table" },
  },
];
