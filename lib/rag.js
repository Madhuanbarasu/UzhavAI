// lib/rag.js — Agricultural Knowledge Retrieval (RAG) module for UzhavAI.
// Contains grounded agricultural knowledge sourced from ICAR (Indian Council of
// Agricultural Research), State Agriculture Department advisories (Tamil Nadu / National),
// government schemes (PM-KISAN, PMFBY, Subsidies, KCC), and live mandi data.
//
// Provides keyword and TF-IDF semantic retrieval to augment the prompt with
// grounded facts before the AI generates an answer.

const { fetchMandiPrices, STATIC_PRICES } = require("./mandi");

// --- 1. Grounded Government Schemes & Subsidies -----------------------------
const SCHEMES_KNOWLEDGE = [
  {
    id: "pm-kisan",
    name: "PM-KISAN (Pradhan Mantri Kisan Samman Nidhi)",
    name_ta: "பிஎம்-கிசான் (பிரதம மந்திரி கிசான் சம்மான் நிதி)",
    category: "income_support",
    keywords: ["pm-kisan", "pmkisan", "6000", "installment", "income support", "கிசான்", "ரூபாய்", "தவணை", "உதவித்தொகை"],
    summary_en: "₹6,000 per year direct income support in three ₹2,000 instalments for landholding farmer families.",
    summary_ta: "நிலமுள்ள விவசாய குடும்பங்களுக்கு ஆண்டுக்கு ₹6,000 நேரடி உதவி (மூன்று ₹2,000 தவணைகள்).",
    eligibility_en: "All landholding farmer families with cultivable landholding in their names. Excluded: institutional landholders, farmer families holding constitutional posts, former/present ministers, mayors, government employees, pensioners with monthly pension ₹10,000+, income-tax payers, and professionals (doctors, engineers, lawyers, CA). e-KYC is mandatory via pmkisan.gov.in.",
    eligibility_ta: "தங்கள் பெயரில் சாகுபடி நிலம் வைத்துள்ள அனைத்து விவசாய குடும்பங்கள். விலக்கு: நிறுவன நில உரிமையாளர்கள், அரசு ஊழியர்கள், ஓய்வூதியம் ₹10,000க்கு மேல் பெறுவோர், வருமான வரி செலுத்துவோர், மருத்துவர்கள், வழக்கறிஞர்கள். pmkisan.gov.in மூலம் e-KYC கட்டாயம்.",
    portal: "https://pmkisan.gov.in",
    helpline: "155261 / 011-24300606",
  },
  {
    id: "pmfby",
    name: "PMFBY (Pradhan Mantri Fasal Bima Yojana - Crop Insurance)",
    name_ta: "பயிர் காப்பீட்டுத் திட்டம் (PMFBY)",
    category: "crop_insurance",
    keywords: ["pmfby", "crop insurance", "fasal bima", "insurance claim", "flood", "drought", "loss", "காப்பீடு", "பயிர் இழப்பு", "வறட்சி", "வெள்ளம்", "இழப்பீடு"],
    summary_en: "Low-cost crop insurance covering yield loss from natural calamities, pests, and post-harvest risks.",
    summary_ta: "இயற்கை பேரிடர்கள், பூச்சி தாக்குதல் மற்றும் அறுவடைக்கு பிந்தைய இழப்புகளுக்கு குறைந்த கட்டணத்தில் பயிர் காப்பீடு.",
    eligibility_en: "All farmers growing notified crops in notified areas (both loanee and non-loanee). Premium rates: Kharif food/oilseeds 2%, Rabi food/oilseeds 1.5%, Commercial/Horticultural crops 5%. Covers: prevented sowing, standing crop damage (drought, flood, pests), post-harvest losses up to 14 days, and localized calamities. Claims must be reported within 72 hours via Crop Insurance App or toll-free 14447.",
    eligibility_ta: "அறிவிக்கப்பட்ட பகுதிகளில் பயிரிடும் அனைத்து விவசாயிகள் (கடன் பெற்றோர் மற்றும் பெறாதோர்). பிரீமியம்: காரிஃப் உணவுப் பயிர் 2%, ரபி 1.5%, வணிக/தோட்டக்கலை பயிர்கள் 5%. விதைப்புத் தடுப்பு, வறட்சி, வெள்ளம், பூச்சி தாக்குதல், அறுவடைக்கு பிந்தைய இழப்பு (14 நாட்கள் வரை) உள்ளடங்கும். இழப்பு ஏற்பட்ட 72 மணி நேரத்திற்குள் 14447 என்ற எண்ணிலோ அல்லது செயலியிலோ தெரிவிக்க வேண்டும்.",
    portal: "https://pmfby.gov.in",
    helpline: "14447 / 1800-180-1551",
  },
  {
    id: "smam-mechanization",
    name: "SMAM (Sub-Mission on Agricultural Mechanization / Tractor Subsidy)",
    name_ta: "வேளாண் இயந்திரமயமாக்கல் திட்டம் (டிராக்டர் மற்றும் கருவிகள் மானியம்)",
    category: "subsidy",
    keywords: ["tractor", "subsidy", "machinery", "power tiller", "rotavator", "smam", "டிராக்டர்", "மானியம்", "இயந்திரம்", "பவர் டில்லர்", "ரோட்டவேட்டர்"],
    summary_en: "40% to 50% subsidy for purchasing tractors, power tillers, rotavators, and farm equipment.",
    summary_ta: "டிராக்டர், பவர் டில்லர், ரோட்டவேட்டர் போன்ற வேளாண் கருவிகள் வாங்க 40% முதல் 50% வரை மானியம்.",
    eligibility_en: "Individual farmers, Self Help Groups, and FPOs. Small/marginal farmers, SC/ST, and women farmers receive up to 50% subsidy (up to ₹2 Lakh for tractors, 50% for tillers); other farmers receive 40%. Requires land documents (chitta/patta), Aadhaar, bank passbook. Applications through the Agrimachinery portal or Tamil Nadu Agricultural Engineering Department.",
    eligibility_ta: "சிறு, குறு விவசாயிகள், பட்டியலினத்தவர் மற்றும் பெண் விவசாயிகளுக்கு 50% வரை மானியம் (டிராக்டருக்கு ₹2 லட்சம் வரை); இதர விவசாயிகளுக்கு 40%. பட்டா/சிட்டா, ஆதார், வங்கி கணக்கு புத்தகம் தேவை. வேளாண் பொறியியல் துறை அல்லது agrimachinery.nic.in மூலம் விண்ணப்பிக்கலாம்.",
    portal: "https://agrimachinery.nic.in",
    helpline: "1800-180-1551",
  },
  {
    id: "pm-kusum",
    name: "PM-KUSUM (Solar Irrigation Pump Subsidy)",
    name_ta: "பிஎம்-குசும் (சூரிய சக்தி பாசன பம்ப் மானியம்)",
    category: "subsidy",
    keywords: ["solar pump", "kusum", "solar irrigation", "electricity", "சூரிய சக்தி", "பம்ப்", "குசும்", "மின்சாரம்", "சோலார்"],
    summary_en: "Up to 60-70% financial subsidy for installing stand-alone solar agricultural water pumps (up to 7.5 HP).",
    summary_ta: "விவசாய நிலங்களில் தனித்த சூரிய சக்தி பாசன பம்புகள் (7.5 HP வரை) அமைக்க 60% முதல் 70% வரை மானியம்.",
    eligibility_en: "Individual farmers, water user associations, and farmer groups. Central Government provides 30% subsidy, State Government (e.g. TEDA in Tamil Nadu) provides 30-40%, farmer contributes only 30-40% (often bank loan eligible). Priority for un-electrified diesel pump replacements.",
    eligibility_ta: "தனிநபர் விவசாயிகள், பாசன சங்கங்கள். மத்திய அரசு 30%, மாநில அரசு 30-40% மானியம் வழங்குகிறது; விவசாயி பங்கு 30-40% மட்டுமே (வங்கி கடன் வசதி உண்டு). டீசல் பம்புகளுக்கு மாற்றாக முன்னுரிமை.",
    portal: "https://pmkusum.mnre.gov.in",
    helpline: "1800-180-3333",
  },
  {
    id: "micro-irrigation",
    name: "Micro Irrigation Scheme (Per Drop More Crop - PMKSY)",
    name_ta: "நுண்ணீர்ப்பாசனத் திட்டம் (சொட்டு நீர் & தெளிப்பு நீர் பாசனம் - PMKSY)",
    category: "subsidy",
    keywords: ["drip", "sprinkler", "micro irrigation", "per drop", "water saving", "சொட்டு நீர்", "தெளிப்பு நீர்", "பாசனம்", "தண்ணீர் சேமிப்பு"],
    summary_en: "100% subsidy for small/marginal farmers in Tamil Nadu, 75% for other farmers for drip/sprinkler installation.",
    summary_ta: "தமிழ்நாட்டில் சிறு/குறு விவசாயிகளுக்கு 100% மானியம், இதர விவசாயிகளுக்கு 75% மானியத்தில் சொட்டு நீர்/தெளிப்பு நீர் பாசனம்.",
    eligibility_en: "Farmers possessing cultivable land with an assured irrigation source (well/borewell). In Tamil Nadu, small and marginal farmers (< 5 acres) receive 100% subsidy; large farmers receive 75% subsidy. Handled by Horticulture and Agriculture departments.",
    eligibility_ta: "பாசன நீர் ஆதாரம் (கிணறு/ஆழ்துளை கிணறு) உள்ள நில உரிமையாளர்கள். தமிழ்நாட்டில் சிறு/குறு விவசாயிகளுக்கு (< 5 ஏக்கர்) 100% முழு மானியம்; பெரு விவசாயிகளுக்கு 75% மானியம். தோட்டக்கலை மற்றும் வேளாண்மைத்துறை மூலம் செயல்படுத்தப்படுகிறது.",
    portal: "https://tnhorticulture.tn.gov.in",
    helpline: "1800-180-1551",
  },
  {
    id: "kcc",
    name: "Kisan Credit Card (KCC - Crop Loans)",
    name_ta: "கிசான் கடன் அட்டை (KCC - பயிர்க் கடன்)",
    category: "credit",
    keywords: ["kcc", "kisan credit card", "crop loan", "interest", "bank loan", "கடன்", "கிசான் கடன் அட்டை", "வட்டி", "வங்கி கடன்"],
    summary_en: "Low-interest institutional credit up to ₹3 Lakh at an effective 4% interest rate with prompt repayment.",
    summary_ta: "சரியான நேரத்தில் திரும்பச் செலுத்தினால் 4% வட்டியில் ₹3 லட்சம் வரை சலுகை பயிர்க்கடன்.",
    eligibility_en: "All farmers, tenant farmers, sharecroppers, and self-help groups. Base interest is 7%, government provides 3% prompt repayment incentive, making effective rate 4%. Collateral-free loans up to ₹1.60 Lakh. Covers crop cultivation, post-harvest expenses, and farm asset maintenance.",
    eligibility_ta: "அனைத்து விவசாயிகள், குத்தகை விவசாயிகள், சுயஉதவி குழுக்கள். அடிப்படை வட்டி 7%, குறித்த காலத்தில் செலுத்தினால் 3% சலுகை போக 4% வட்டி மட்டுமே. ₹1.60 லட்சம் வரை எவ்வித பிணையும் இன்றி கடன் பெறலாம்.",
    portal: "https://myscheme.gov.in/schemes/kcc",
    helpline: "1800-180-1551 / 1800-11-5526",
  },
  {
    id: "soil-health-card",
    name: "Soil Health Card Scheme",
    name_ta: "மண் ஆரோக்கிய அட்டை திட்டம்",
    category: "soil_health",
    keywords: ["soil health", "soil test", "fertilizer", "npk", "மண் பரிசோதனை", "மண் அட்டை", "உரம்", "ஊட்டச்சத்து"],
    summary_en: "Free soil testing every 2 years with crop-specific fertilizer recommendations.",
    summary_ta: "2 ஆண்டுக்கு ஒருமுறை இலவச மண் பரிசோதனை மற்றும் பயிருக்கான உரப் பரிந்துரை.",
    eligibility_en: "Available to all farmers. Tests 12 parameters: Primary nutrients (N, P, K), Secondary nutrient (S), Micronutrients (Zn, Fe, Cu, Mn, Bo), and Physical parameters (pH, EC, OC). Free of cost at state soil testing laboratories.",
    eligibility_ta: "அனைத்து விவசாயிகளுக்கும் கிடைக்கும். 12 அளவுருக்கள் பரிசோதிக்கப்படும்: N, P, K, கந்தகம், நுண்ணூட்டச்சத்துக்கள் (துத்தநாகம், இரும்பு, போரான்), pH மற்றும் கரிம கார்பன். அரசு மண் பரிசோதனை ஆய்வகங்களில் முற்றிலும் இலவசம்.",
    portal: "https://soilhealth.dac.gov.in",
    helpline: "1800-180-1551",
  },
];

// --- 2. Grounded ICAR Pest & Disease Advisories ------------------------------
const ICAR_PEST_KNOWLEDGE = [
  {
    id: "rice-blast",
    crop: "Paddy (Rice)",
    crop_ta: "நெல்",
    problem: "Blast Disease (Pyricularia oryzae)",
    problem_ta: "குலை நோய் (பிளாஸ்ட்)",
    keywords: ["rice", "paddy", "blast", "spindle", "leaf spots", "நெல்", "குலை நோய்", "புள்ளி", "கதிர்"],
    symptoms_en: "Spindle-shaped lesions with brown margins and grey/white centres on leaves, neck blast causes chaffy grains and neck breakage.",
    symptoms_ta: "இலைகளில் சுழல் வடிவ பழுப்பு விளிம்புடன் கூடிய சாம்பல்/வெள்ளை நிற புள்ளிகள்; கதிர் கழுத்தில் கருமை தோன்றி மணிகள் பதராகும்.",
    organic_care_en: "Avoid excessive nitrogen fertilizers; apply bio-control agent Pseudomonas fluorescens @ 10g/kg seed treatment and 2.5 kg/ha foliar spray; burn infected stubbles.",
    organic_care_ta: "அதிகப்படியான தழைச்சத்தை (யூரியா) தவிர்க்கவும்; சூடோமோனாஸ் ஃபுளோரசன்ஸ் விதை நேர்த்தி (10 கிராம்/கிலோ) மற்றும் இலைவழி தெளிப்பு (2.5 கிலோ/ஹெக்டர்) செய்யவும்.",
    caution_en: "For severe outbreak, consult your local agricultural officer before spraying chemical fungicides (Tricyclazole or Azoxystrobin).",
    caution_ta: "தீவிர தாக்குதல் இருந்தால், ரசாயன பூஞ்சாணக்கொல்லி (டிரைசைக்ளசோல்) தெளிக்கும் முன் உள்ளூர் வேளாண் அலுவலரிடம் ஆலோசனை பெறவும்.",
  },
  {
    id: "rice-stem-borer",
    crop: "Paddy (Rice)",
    crop_ta: "நெல்",
    problem: "Yellow Stem Borer (Scirpophaga incertulas)",
    problem_ta: "தண்டு துளைப்பான் (குருத்து பூச்சி)",
    keywords: ["rice", "paddy", "stem borer", "dead heart", "white ear", "நெல்", "தண்டு துளைப்பான்", "குருத்தழுகல்", "வெண் கதிர்"],
    symptoms_en: "Dead hearts in vegetative stage (central shoot dries and pulls out easily); white ears in reproductive stage (empty erect white panicles).",
    symptoms_ta: "பயிர் வளர்ச்சியின் போது நடுக்குருத்து காய்ந்து எளிதில் இழுத்து வரும் (குருத்தழுகல்); கதிர் பருவத்தில் வெண் கதிர்கள் தோன்றி மணிகள் இருக்காது.",
    organic_care_en: "Install pheromone traps @ 12/ha; clip seedling tips before transplanting to remove egg masses; release Trichogramma egg parasitoid @ 1,00,000/ha.",
    organic_care_ta: "ஹெக்டேருக்கு 12 இனக்கவர்ச்சி பொறிகள் வைக்கவும்; நடவுக்கு முன் நாற்றின் நுனிகளை கிள்ளி முட்டை குவியல்களை அழிக்கவும்; டிரைக்கோடெர்மா ஒட்டுண்ணி அட்டை பயன்படுத்தவும்.",
    caution_en: "Chemical intervention requires expert guidance on economic threshold levels (ETL: 2 egg masses/sq.m or 10% dead hearts).",
    caution_ta: "பொருளாதார சேத நிலை (10% நடுக்குருத்து காய்வு) எட்டினால் மட்டுமே நிபுணர் வழிகாட்டலுடன் பரிந்துரைக்கப்பட்ட மருந்தை பயன்படுத்தவும்.",
  },
  {
    id: "tomato-early-late-blight",
    crop: "Tomato",
    crop_ta: "தக்காளி",
    problem: "Early Blight & Late Blight (Alternaria solani / Phytophthora)",
    problem_ta: "இலை கருகல் நோய் (முன்/பின் பருவ கருகல்)",
    keywords: ["tomato", "blight", "concentric rings", "brown spots", "black rot", "தக்காளி", "கருகல்", "புள்ளி", "இலை கருகல்"],
    symptoms_en: "Early blight: concentric dark brown target rings on older leaves. Late blight: water-soaked pale green/black lesions rapidly spreading under cool humid weather.",
    symptoms_ta: "முன் கருகல்: கீழ் இலைகளில் வளைய வடிவிலான பழுப்பு புள்ளிகள். பின் கருகல்: குளிர்ந்த ஈரப்பதமான சூழலில் நீர் ஊறிய கரும்பழுப்பு புள்ளிகள் இலை முழுவதும் வேகமாக பரவும்.",
    organic_care_en: "Practice crop rotation (avoid solanaceous crops consecutively); stake plants to avoid soil contact; spray neem oil 3% or copper oxychloride at initial onset.",
    organic_care_ta: "பயிர் சுழற்சி முறை பின்பற்றவும்; செடிகளை தடி ஊன்றி கட்டவும்; ஆரம்ப நிலையில் வேப்ப எண்ணெய் (3%) அல்லது சூடோமோனாஸ் தெளிக்கவும்.",
    caution_en: "Do not guess fungicide doses; over-spraying risks chemical residues in food and soil toxicity.",
    caution_ta: "பூஞ்சாணக்கொல்லி மருந்தளவை சுயமாக தீர்மானிக்க வேண்டாம்; அதிகப்படியான தெளிப்பு நச்சுத்தன்மையை உண்டாக்கும்.",
  },
  {
    id: "tomato-leaf-curl",
    crop: "Tomato",
    crop_ta: "தக்காளி",
    problem: "Tomato Leaf Curl Virus (ToLCV) transmitted by Whitefly",
    problem_ta: "இலை சுருட்டு நோய் (வெள்ளை ஈ மூலம் பரவும் வைரஸ்)",
    keywords: ["tomato", "leaf curl", "whitefly", "curling", "stunted", "தக்காளி", "இலை சுருட்டு", "வெள்ளை ஈ", "சுருங்குதல்"],
    symptoms_en: "Upward or downward curling of leaves, leaf thickening, puckering, stunted plant growth, failure to set fruit.",
    symptoms_ta: "இலைகள் மேல்நோக்கி அல்லது கீழ்நோக்கி சுருண்டு தடிமனாதல், நரம்புகள் தடித்தல், செடி வளர்ச்சி குன்றி பூக்கள் உதிர்ந்து காய் பிடிக்காமல் போதல்.",
    organic_care_en: "Install yellow sticky traps @ 20/acre to monitor and trap whiteflies; remove and burn infected plants early; spray neem seed kernel extract (NSKE 5%).",
    organic_care_ta: "ஏக்கருக்கு 20 மஞ்சள் நிற ஒட்டும் பொறிகள் வைத்து வெள்ளை ஈக்களை கட்டுப்படுத்தவும்; பாதிக்கப்பட்ட செடிகளை பிடுங்கி அழிக்கவும்; வேப்பங்கொட்டை கரைசல் (5%) தெளிக்கவும்.",
    caution_en: "Viruses have no direct chemical cure; manage only the insect vector. Seek advice from your local KVK.",
    caution_ta: "வைரஸ் நோய்க்கு நேரடி ரசாயன சிகிச்சை இல்லை; பரப்பும் வெள்ளை ஈக்களை மட்டுமே கட்டுப்படுத்த வேண்டும். வேளாண் அறிவியல் நிலையத்தை அணுகவும்.",
  },
  {
    id: "banana-panama-sigatoka",
    crop: "Banana",
    crop_ta: "வாழை",
    problem: "Panama Wilt (Fusarium oxysporum) & Sigatoka Leaf Spot",
    problem_ta: "பனாமா வாடல் நோய் & சிகடோகா இலைப்புள்ளி நோய்",
    keywords: ["banana", "wilt", "sigatoka", "yellow leaves", "pseudostem splitting", "வாழை", "வாடல்", "சிகடோகா", "மஞ்சள் இலை", "தண்டு வெடிப்பு"],
    symptoms_en: "Panama wilt: yellowing of lower leaves spreading upward, pseudostem splitting at base. Sigatoka: spindle-shaped brown spots with grey centres drying large leaf areas.",
    symptoms_ta: "வாடல்: கீழ் இலைகள் மஞ்சள் நிறமாகி தொங்குதல், மரத்தின் அடிப்பகுதி நீளவாக்கில் வெடித்தல். சிகடோகா: இலைகளில் நீள்வட்ட பழுப்பு புள்ளிகள் தோன்றி இலைகள் காய்ந்து போதல்.",
    organic_care_en: "Use disease-free tissue culture plantlets; dip suckers in Pseudomonas fluorescens (20g/L); cut and destroy severely infected Sigatoka leaves.",
    organic_care_ta: "நோய் இல்லாத திசு வளர்ப்பு கன்றுகளை தேர்வு செய்யவும்; கன்றுகளை சூடோமோனாஸ் கரைசலில் முக்கி நடவும்; பாதிக்கப்பட்ட இலைகளை வெட்டி எரிக்கவும்.",
    caution_en: "Panama wilt is soil-borne; do not replant banana in infested soil without rotation. Confirm with an expert before any chemical drenching.",
    caution_ta: "பனாமா வாடல் நோய் மண்ணில் வாழும் பூஞ்சை; பாதிக்கப்பட்ட நிலத்தில் வாழை நடவு செய்வதை தவிர்க்கவும். நிபுணர் ஆலோசனையின்றி ரசாயனம் ஊற்ற வேண்டாம்.",
  },
  {
    id: "onion-purple-blotch",
    crop: "Onion",
    crop_ta: "வெங்காயம்",
    problem: "Purple Blotch & Thrips (Alternaria porri / Thrips tabaci)",
    problem_ta: "வெங்காய ஊதா நிற இலை கருகல் & இலைப்பேன்",
    keywords: ["onion", "purple blotch", "thrips", "silvery patches", "வெங்காயம்", "ஊதா கருகல்", "இலைப்பேன்", "வெள்ளி நிற புள்ளி"],
    symptoms_en: "Small water-soaked sunken lesions turning purplish with yellow halo; thrips cause silvery white speckles on leaves and curled leaf tips.",
    symptoms_ta: "இலைகளில் சிறிய நீரூறிய ஊதா நிற புள்ளிகள்; இலைப்பேன் தாக்கும்போது இலைகளில் வெள்ளி நிற வரிகளும் நுனி கருகலும் தோன்றும்.",
    organic_care_en: "Install blue/yellow sticky traps @ 15/acre; spray neem oil (3ml/L) with wetting agent; provide good drainage and avoid waterlogging.",
    organic_care_ta: "ஏக்கருக்கு 15 நீல/மஞ்சள் வண்ண ஒட்டுப்பொறிகள் அமைக்கவும்; வேப்ப எண்ணெய் (3 மி.லி/லி) ஒட்டும் திரவத்துடன் தெளிக்கவும்; நல்ல வடிகால் வசதி அமைக்கவும்.",
    caution_en: "Observe safe pre-harvest waiting periods (PHI) before marketing onions treated with chemicals.",
    caution_ta: "ரசாயன மருந்து தெளிக்கப்பட்ட வெங்காயத்தை அறுவடை செய்ய பரிந்துரைக்கப்பட்ட காத்திருப்பு காலத்தை கண்டிப்பாக பின்பற்றவும்.",
  },
];

// --- 3. RAG Retrieval Engine -------------------------------------------------

// Tokenize text into words/stems (handles English and Tamil).
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  // Split on whitespace, punctuation, and symbols
  const words = text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'<>।]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return words;
}

// Compute relevance score of a knowledge item against a query.
function scoreItem(item, queryTokens, queryText) {
  let score = 0;
  const qLower = queryText.toLowerCase();

  // Keyword exact matches
  if (Array.isArray(item.keywords)) {
    for (const kw of item.keywords) {
      const kwLower = kw.toLowerCase();
      if (qLower.includes(kwLower)) {
        score += 5; // Strong boost for explicit keyword match
      }
    }
  }

  // Crop / Problem / Scheme name match
  const nameFields = [item.name, item.name_ta, item.crop, item.crop_ta, item.problem, item.problem_ta].filter(Boolean);
  for (const nf of nameFields) {
    if (qLower.includes(nf.toLowerCase())) {
      score += 4;
    }
  }

  // Token overlap in text content
  const content = [
    item.summary_en, item.summary_ta, item.eligibility_en, item.eligibility_ta,
    item.symptoms_en, item.symptoms_ta, item.organic_care_en, item.organic_care_ta,
  ].filter(Boolean).join(" ").toLowerCase();

  for (const token of queryTokens) {
    if (content.includes(token)) {
      score += 1;
    }
  }

  return score;
}

// Check if the query is asking about mandi / market prices.
function isPriceQuery(text) {
  if (!text) return false;
  const PRICE_PATTERNS = [
    /\b(price|prices|rate|rates|mandi|market|cost|selling|worth|bhav)\b/i,
    /விலை/, /மண்டி/, /சந்தை/, /விற்பனை/, /மதிப்பு/, /ரேட்/,
  ];
  return PRICE_PATTERNS.some((re) => re.test(text));
}

// Format mandi data into a concise grounded note string.
function formatMandiContext(prices, source, date) {
  if (!prices || prices.length === 0) return "";
  const sourceLabel = source === "live"
    ? `Live data from data.gov.in (AgMarkNet)${date ? ` as of ${date}` : ""}`
    : "Static demo snapshot (representative prices; verify at your local mandi)";
  const rows = prices
    .slice(0, 7)
    .map((p) => `${p.crop}: ₹${Number(p.price).toLocaleString("en-IN")}/quintal at ${p.market}`)
    .join("; ");
  return `Mandi Price Data [${sourceLabel}]: ${rows}.`;
}

// Main RAG retrieval function.
// Given a farmer's query, returns grounded reference text to include in <notes>.
async function retrieveContext(query, { lang = "en", topK = 2, mandiPrices = null } = {}) {
  const queryTokens = tokenize(query);
  const qText = String(query || "").trim();
  const notes = [];

  // 1. If asking about prices, include live/cached mandi prices.
  if (isPriceQuery(qText)) {
    try {
      const mandiResult = mandiPrices || await fetchMandiPrices();
      if (mandiResult && Array.isArray(mandiResult.prices)) {
        notes.push(formatMandiContext(mandiResult.prices, mandiResult.source, mandiResult.fetchedAt));
      }
    } catch (e) {
      notes.push(formatMandiContext(STATIC_PRICES, "static", null));
    }
  }

  // 2. Score and retrieve relevant schemes / subsidies.
  const scoredSchemes = SCHEMES_KNOWLEDGE
    .map((s) => ({ item: s, score: scoreItem(s, queryTokens, qText), type: "scheme" }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // 3. Score and retrieve relevant ICAR pest & disease advisories.
  const scoredPests = ICAR_PEST_KNOWLEDGE
    .map((p) => ({ item: p, score: scoreItem(p, queryTokens, qText), type: "pest" }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  // Combine top matches.
  const allMatches = [...scoredSchemes, ...scoredPests].sort((a, b) => b.score - a.score);
  const selected = allMatches.slice(0, topK);

  for (const { item, type } of selected) {
    if (type === "scheme") {
      if (lang === "ta") {
        notes.push(`அரசு திட்டம் [${item.name_ta} / ${item.name}]: ${item.summary_ta} தகுதி: ${item.eligibility_ta} உதவி எண்: ${item.helpline}`);
      } else {
        notes.push(`Government Scheme [${item.name}]: ${item.summary_en} Eligibility: ${item.eligibility_en} Helpline: ${item.helpline}`);
      }
    } else if (type === "pest") {
      if (lang === "ta") {
        notes.push(`ICAR வேளாண் வழிகாட்டல் [${item.crop_ta} - ${item.problem_ta}]: அறிகுறிகள்: ${item.symptoms_ta} பராமரிப்பு: ${item.organic_care_ta} எச்சரிக்கை: ${item.caution_ta}`);
      } else {
        notes.push(`ICAR Advisory [${item.crop} - ${item.problem}]: Symptoms: ${item.symptoms_en} Management: ${item.organic_care_en} Safety: ${item.caution_en}`);
      }
    }
  }

  return notes.join("\n\n");
}

module.exports = {
  retrieveContext,
  isPriceQuery,
  formatMandiContext,
  tokenize,
  scoreItem,
  SCHEMES_KNOWLEDGE,
  ICAR_PEST_KNOWLEDGE,
};
