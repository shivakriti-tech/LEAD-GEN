/**
 * Business types a website-development agency typically sells to.
 * `google` is the Text Search phrase; `osm` are OpenStreetMap tag filters.
 */
export interface CategoryPreset {
  key: string;
  label: string;
  group: string;
  google: string;
  osm: string[]; // Overpass filter fragments, e.g. ["amenity"="dentist"]
}

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
];

export const categoryByKey = (key: string) => CATEGORIES.find((c) => c.key === key);
