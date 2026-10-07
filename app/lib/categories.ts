import type { NicheKey, Offer } from "./types";

/**
 * Business types a website-development agency typically sells to.
 * `google` is the Text Search phrase; `osm` are OpenStreetMap tag filters.
 */
export interface CategoryPreset {
  key: string;
  label: string;
  group: string;
  google: string;
  osm: string[]; // Overpass filter fragments, e.g. ["amenity"="dentist"]; empty = not on the map
  /** Which offering this type is for (default: websites). "niche": only for the niches in lib/niches.ts. */
  sells?: "logistics" | "agency" | "niche";
  /** Agency searches: an online store (store upgrades) or a mid-size company (CRM/ERP, automation). */
  track?: "store" | "company";
}

/*
 * Factories in India are rarely tagged by what they make (industrial=pharmaceutical is almost never
 * used). They're on the map as a named factory building, industrial compound, workshop or company
 * office, so they're found by name inside those. Estate names (GIDC, industrial area…) are skipped.
 */
const NOT_ESTATE = '["name"!~"GIDC|MIDC|estate|industrial (area|park|zone|hub)|phase|SEZ",i]';
const inIndustry = (words: string) => {
  const n = `["name"~"${words}",i]`;
  return [
    `["industrial"]${n}`,
    `["man_made"="works"]${n}`,
    `["building"~"^(industrial|factory|warehouse)$"]${n}`,
    `["landuse"="industrial"]${n}${NOT_ESTATE}`,
    `["craft"]${n}`,
    `["office"="company"]${n}`,
  ];
};
const inOffices = (words: string) => [`["office"]["name"~"${words}",i]`, `["man_made"="works"]["name"~"${words}",i]`, `["building"~"^(industrial|commercial|office|warehouse)$"]["name"~"${words}",i]`];

export const CATEGORIES: CategoryPreset[] = [
  { key: "dentist", label: "Dentist", group: "Clinics", google: "dental clinic", osm: ['["amenity"="dentist"]', '["healthcare"="dentist"]'] },
  { key: "skin", label: "Skin clinic", group: "Clinics", google: "skin clinic dermatologist", osm: ['["healthcare:speciality"="dermatology"]'] },
  { key: "physio", label: "Physiotherapy", group: "Clinics", google: "physiotherapy clinic", osm: ['["healthcare"="physiotherapist"]'] },
  { key: "clinic", label: "General clinic", group: "Clinics", google: "clinic doctor", osm: ['["amenity"="clinic"]', '["amenity"="doctors"]'] },
  { key: "salon", label: "Salon & spa", group: "Beauty & fitness", google: "beauty salon", osm: ['["shop"="beauty"]', '["shop"="hairdresser"]', '["leisure"="spa"]'] },
  { key: "gym", label: "Gym & yoga", group: "Beauty & fitness", google: "gym fitness centre", osm: ['["leisure"="fitness_centre"]', '["sport"="yoga"]'] },
  { key: "restaurant", label: "Restaurant", group: "Food", google: "restaurant", osm: ['["amenity"="restaurant"]'] },
  { key: "cafe", label: "Café & bakery", group: "Food", google: "cafe", osm: ['["amenity"="cafe"]', '["shop"="bakery"]'] },
  { key: "coaching", label: "Coaching institute", group: "Education", google: "coaching institute classes", osm: ['["amenity"="school"]["school"!="public"]', '["office"="educational_institution"]', '["amenity"="training"]'] },
  { key: "realestate", label: "Real estate agent", group: "Services", google: "real estate agent", osm: ['["office"="estate_agent"]'] },
  { key: "interior", label: "Interior designer", group: "Services", google: "interior designer", osm: ['["craft"="interior_decorator"]', '["shop"="interior_decoration"]'] },
  { key: "ca", label: "CA & tax consultant", group: "Services", google: "chartered accountant", osm: ['["office"="accountant"]', '["office"="tax_advisor"]'] },
  { key: "lawyer", label: "Lawyer", group: "Services", google: "lawyer advocate", osm: ['["office"="lawyer"]'] },
  { key: "hotel", label: "Hotel & homestay", group: "Travel", google: "hotel", osm: ['["tourism"="hotel"]', '["tourism"="guest_house"]'] },
  { key: "furniture", label: "Furniture shop", group: "Retail", google: "furniture shop", osm: ['["shop"="furniture"]'] },
  { key: "retail", label: "Retail shop", group: "Retail", google: "clothing store", osm: ['["shop"="clothes"]', '["shop"="boutique"]'] },
  // more local businesses that win customers online
  { key: "vet", label: "Vet & pet clinic", group: "Clinics", google: "veterinary clinic pet clinic", osm: ['["amenity"="veterinary"]', '["shop"="pet_grooming"]'] },
  { key: "diagnostic", label: "Diagnostic lab", group: "Clinics", google: "diagnostic centre pathology lab", osm: ['["healthcare"="laboratory"]', '["healthcare"]["name"~"diagnostic|patholog|path lab|imaging|scan centre",i]'] },
  { key: "pharmacy", label: "Pharmacy & chemist", group: "Clinics", google: "pharmacy medical store", osm: ['["amenity"="pharmacy"]', '["shop"="chemist"]'] },
  { key: "optician", label: "Optician", group: "Clinics", google: "optician eye clinic", osm: ['["shop"="optician"]', '["healthcare"="optometrist"]'] },
  { key: "preschool", label: "Preschool & daycare", group: "Education", google: "preschool play school daycare", osm: ['["amenity"="kindergarten"]', '["amenity"="childcare"]'] },
  { key: "classes", label: "Dance, music & art classes", group: "Education", google: "dance music art classes", osm: ['["amenity"="music_school"]', '["amenity"="dancing_school"]', '["leisure"="dance"]'] },
  { key: "driving", label: "Driving school", group: "Education", google: "driving school", osm: ['["amenity"="driving_school"]'] },
  { key: "venue", label: "Banquet & wedding venue", group: "Events", google: "banquet hall wedding venue party plot", osm: ['["amenity"="events_venue"]', '["amenity"="conference_centre"]', '["amenity"]["name"~"banquet|party plot|marriage hall|wedding hall|lawns",i]'] },
  { key: "photographer", label: "Photographer & studio", group: "Events", google: "photographer photo studio", osm: ['["craft"="photographer"]', '["shop"="photo"]', '["shop"="photo_studio"]'] },
  { key: "travel", label: "Travel agent", group: "Travel", google: "travel agency tour operator", osm: ['["shop"="travel_agency"]', '["office"="travel_agent"]'] },
  { key: "car_service", label: "Car & bike service", group: "Auto", google: "car service centre garage", osm: ['["shop"="car_repair"]', '["shop"="motorcycle_repair"]', '["amenity"="car_wash"]'] },
  { key: "car_dealer", label: "Car & bike dealer", group: "Auto", google: "car dealer showroom used cars", osm: ['["shop"="car"]', '["shop"="motorcycle"]'] },
  { key: "architect", label: "Architect", group: "Services", google: "architect firm", osm: ['["office"="architect"]'] },
  { key: "jeweller", label: "Jewellery shop", group: "Retail", google: "jewellery shop", osm: ['["shop"="jewelry"]'] },
  { key: "electronics", label: "Electronics & mobile shop", group: "Retail", google: "mobile phone electronics shop", osm: ['["shop"="electronics"]', '["shop"="mobile_phone"]', '["shop"="computer"]'] },
  { key: "hardware", label: "Hardware, paints & tiles", group: "Retail", google: "hardware paint tiles shop", osm: ['["shop"="hardware"]', '["shop"="paint"]', '["shop"="doityourself"]', '["shop"="tiles"]'] },

  // only for the niches (lib/niches.ts): big sites, institutions and offices
  ...niche([
    { key: "hospital", label: "Hospital & nursing home", group: "Institutions", google: "hospital nursing home", osm: ['["amenity"="hospital"]', '["healthcare"="hospital"]'] },
    { key: "school", label: "School & college", group: "Institutions", google: "school college", osm: ['["amenity"="school"]["name"]', '["amenity"="college"]', '["amenity"="university"]'] },
    { key: "cold_storage", label: "Cold storage & ice plant", group: "Factories", google: "cold storage", osm: inIndustry("cold storage|cold chain|ice (plant|factory)|frozen|freez") },
    { key: "warehouse", label: "Warehouse & godown", group: "Factories", google: "warehouse godown", osm: ['["building"="warehouse"]["name"]', '["industrial"="warehouse"]["name"]', ...inOffices("warehous|godown|logistics park")] },
    { key: "it_company", label: "IT & services company", group: "Offices", google: "IT company software services", osm: ['["office"="it"]', '["office"="company"]["name"~"tech|software|solutions|infotech|systems|digital|consult",i]'] },
  ]),

  // Businesses that ship goods: leads for a logistics client
  { key: "manufacturer", label: "Manufacturer", group: "Factories", google: "manufacturer", osm: ['["man_made"="works"]', '["industrial"="factory"]', '["building"~"^(industrial|factory)$"]', `["landuse"="industrial"]${NOT_ESTATE}`, '["name"~"industries|manufactur|udyog|products|mfg",i]["office"]'], sells: "logistics" },
  { key: "textile", label: "Textile & garment maker", group: "Factories", google: "textile manufacturer", osm: ['["industrial"="textile"]', ...inIndustry("textile|fabric|garment|apparel|spinning|weaving|yarn|cotton|silk|knit|denim|dyeing|processors")], sells: "logistics" },
  { key: "chemical", label: "Chemical & plastics", group: "Factories", google: "chemical plastic products manufacturer", osm: ['["industrial"="chemical"]', ...inIndustry("chem|plast|polymer|resin|paint|dye|petro|fertili|pigment|rubber|pack|coating")], sells: "logistics" },
  { key: "pharma", label: "Pharma & medical", group: "Factories", google: "pharmaceutical company", osm: ['["industrial"="pharmaceutical"]', ...inIndustry("pharma|drug|laborator|life ?science|biotech|formulation|healthcare|surgical|medi")], sells: "logistics" },
  { key: "engineering", label: "Engineering & fabrication", group: "Factories", google: "engineering works fabrication", osm: ['["craft"="metal_construction"]', '["industrial"="machine_shop"]', ...inIndustry("engineer|fabricat|forg|casting|foundry|steel|metal|machin|tool|pump|valve|transformer|cable|auto ?parts")], sells: "logistics" },
  { key: "food_proc", label: "Food & agro processing", group: "Factories", google: "food processing unit", osm: ['["industrial"="food"]', ...inIndustry("food|agro|spice|masala|flour|oil mill|rice|dairy|beverage|snack|namkeen|dal mill|cold storage")], sells: "logistics" },
  { key: "exporter", label: "Exporter", group: "Import & export", google: "exporters", osm: inOffices("export|impex|overseas"), sells: "logistics" },
  { key: "importer", label: "Importer", group: "Import & export", google: "importers", osm: inOffices("import|impex|overseas"), sells: "logistics" },
  { key: "wholesaler", label: "Wholesaler", group: "Trade", google: "wholesaler", osm: ['["shop"="wholesale"]', ...inOffices("wholesale|traders|trading")], sells: "logistics" },
  { key: "distributor", label: "Distributor & stockist", group: "Trade", google: "distributor stockist", osm: ['["shop"]["name"~"distribut|stockist",i]', ...inOffices("distribut|stockist")], sells: "logistics" },
  { key: "online_seller", label: "Online seller", group: "Trade", google: "online store ecommerce brand", osm: [], sells: "logistics" },
  { key: "furniture_mfr", label: "Furniture maker", group: "Factories", google: "furniture manufacturer", osm: ['["craft"="carpenter"]', ...inIndustry("furniture|wood|timber|ply|modular")], sells: "logistics" },

  // Your own agency, international: brands that sell online (store builds and upgrades) …
  ...store([
    { key: "store_fashion", label: "Fashion & apparel brand", google: "clothing brand store", osm: ['["shop"="clothes"]', '["shop"="boutique"]', '["shop"="shoes"]'] },
    { key: "store_beauty", label: "Beauty & cosmetics", google: "cosmetics skincare brand", osm: ['["shop"="cosmetics"]', '["shop"="perfumery"]'] },
    { key: "store_home", label: "Home decor & furniture", google: "home decor furniture store", osm: ['["shop"="interior_decoration"]', '["shop"="furniture"]', '["shop"="houseware"]'] },
    { key: "store_jewelry", label: "Jewelry & accessories", google: "jewelry store", osm: ['["shop"="jewelry"]', '["shop"="bag"]', '["shop"="watches"]'] },
    { key: "store_health", label: "Supplements & wellness", google: "supplement health food store", osm: ['["shop"="nutrition_supplements"]', '["shop"="health_food"]'] },
    { key: "store_pet", label: "Pet products", google: "pet supply store", osm: ['["shop"="pet"]'] },
    { key: "store_sports", label: "Sports & outdoor", google: "sporting goods outdoor store", osm: ['["shop"="sports"]', '["shop"="outdoor"]', '["shop"="bicycle"]'] },
    { key: "store_food", label: "Specialty food & drinks", google: "specialty food coffee tea shop", osm: ['["shop"="coffee"]', '["shop"="tea"]', '["shop"="deli"]', '["shop"="wine"]', '["shop"="confectionery"]'] },
    { key: "store_online", label: "Online store (any niche)", google: "online store ecommerce brand", osm: [] },
  ]),
  // … and mid-size companies that run on spreadsheets and email (websites, CRM / ERP, automation)
  ...company([
    { key: "co_freight", label: "Freight forwarding & logistics", google: "freight forwarder logistics company", osm: ['["office"="logistics"]', ...inOffices("logistic|freight|forward|cargo|shipping")] },
    { key: "co_trucking", label: "Trucking & haulage", google: "trucking company", osm: inOffices("trucking|haulage|transport|freight lines|carriers|express") },
    { key: "co_3pl", label: "Warehousing & 3PL", google: "3PL warehousing company", osm: ['["industrial"="warehouse"]["name"]', ...inOffices("warehous|3PL|fulfil|distribution cent|storage")] },
    { key: "co_mining", label: "Mining & minerals", google: "mining company", osm: ['["industrial"="mine"]["name"]', ...inOffices("mining|minerals|resources|quarr|metals")] },
    { key: "co_oilgas", label: "Oil & gas services", google: "oil and gas services company", osm: ['["industrial"="oil"]["name"]', ...inOffices("oil|gas|petrol|drilling|oilfield|energy services")] },
    { key: "co_energy", label: "Renewable energy & solar", google: "solar energy company", osm: ['["office"="energy_supplier"]', ...inOffices("solar|renewable|wind|energy|power")] },
    { key: "co_agri", label: "Agriculture & commodities", google: "agricultural commodities trading company", osm: ['["shop"="agrarian"]', ...inOffices("grain|agri|commodit|farm|seeds|fertili|produce|trading")] },
    { key: "co_manufacturing", label: "Manufacturing", google: "manufacturing company", osm: ['["man_made"="works"]["name"]', '["industrial"="factory"]["name"]', ...inOffices("manufactur|industries|fabricat|products|mfg")] },
    { key: "co_construction", label: "Construction & contracting", google: "construction company", osm: ['["office"="construction_company"]', '["craft"="builder"]', ...inOffices("construction|contracting|contractors|civil|builders")] },
    { key: "co_wholesale", label: "Wholesale & distribution", google: "wholesale distributor", osm: ['["shop"="wholesale"]', ...inOffices("wholesale|distribut|supply|trading")] },
    { key: "co_equipment", label: "Equipment dealers & rental", google: "heavy equipment dealer rental", osm: ['["shop"="machinery"]', '["shop"="tool_hire"]', ...inOffices("equipment|machinery|rental|hire")] },
  ]),
];

type AgencyPreset = Omit<CategoryPreset, "group" | "sells" | "track">;
function niche(xs: Array<Omit<CategoryPreset, "sells" | "track">>): CategoryPreset[] {
  return xs.map((x) => ({ ...x, sells: "niche" }));
}
function store(xs: AgencyPreset[]): CategoryPreset[] {
  return xs.map((x) => ({ ...x, group: "Online stores", sells: "agency", track: "store" }));
}
function company(xs: AgencyPreset[]): CategoryPreset[] {
  return xs.map((x) => ({ ...x, group: "Companies", sells: "agency", track: "company" }));
}

/** The business types for an offering. A niche picks its own from every list (see lib/niches.ts). */
export const categoriesFor = (sells: Offer): CategoryPreset[] => {
  if (sells === "website_development" || sells === "logistics" || sells === "agency") return CATEGORIES.filter((c) => (c.sells ?? "website_development") === sells);
  return (NICHE_CATEGORIES[sells] ?? []).map((k) => CATEGORIES.find((c) => c.key === k)).filter((c): c is CategoryPreset => !!c);
};

/**
 * Who each niche sells to. Kept here (not in lib/niches.ts) so the search form can list them without
 * loading the scoring and messages.
 */
export const NICHE_CATEGORIES: Record<NicheKey, string[]> = {
  marketing: ["dentist", "skin", "physio", "clinic", "vet", "diagnostic", "optician", "salon", "gym", "restaurant", "cafe", "hotel", "coaching", "preschool", "classes", "realestate", "interior", "car_service", "car_dealer", "jeweller", "furniture", "retail", "venue", "travel"],
  solar: ["manufacturer", "textile", "chemical", "pharma", "engineering", "food_proc", "furniture_mfr", "cold_storage", "warehouse", "hospital", "school", "hotel"],
  accounting: ["wholesaler", "distributor", "manufacturer", "textile", "engineering", "exporter", "importer", "online_seller", "retail", "restaurant", "it_company", "clinic", "dentist"],
  staffing: ["manufacturer", "engineering", "textile", "pharma", "food_proc", "warehouse", "hospital", "hotel", "restaurant", "retail", "it_company", "school"],
  insurance: ["exporter", "importer", "manufacturer", "chemical", "pharma", "textile", "engineering", "food_proc", "warehouse", "cold_storage", "hospital", "school", "hotel", "it_company", "wholesaler"],
};

export const categoryByKey = (key: string) => CATEGORIES.find((c) => c.key === key);
