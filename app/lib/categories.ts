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
  /** Which offering this type is for (default: websites). */
  sells?: "logistics";
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
];

/** The business types for an offering. */
export const categoriesFor = (sells: "website_development" | "logistics") => CATEGORIES.filter((c) => (c.sells ?? "website_development") === sells);

export const categoryByKey = (key: string) => CATEGORIES.find((c) => c.key === key);
