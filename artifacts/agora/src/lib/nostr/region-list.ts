// Built-in list of well-known regions used by the manual Nearby region
// picker. Coordinates are city-center approximations; the picker pipes
// every selection through `coarsen()` before publishing, so the precise
// numbers here never leave the device. Kept intentionally compact (no
// network lookup) so it works offline, on VPNs, and on desktops without
// geolocation.

export type Region = {
  name: string;
  country: string;
  lat: number;
  lng: number;
};

export const REGIONS: Region[] = [
  // Africa
  { name: "Cairo", country: "Egypt", lat: 30.04, lng: 31.24 },
  { name: "Lagos", country: "Nigeria", lat: 6.52, lng: 3.38 },
  { name: "Nairobi", country: "Kenya", lat: -1.29, lng: 36.82 },
  { name: "Johannesburg", country: "South Africa", lat: -26.2, lng: 28.05 },
  { name: "Cape Town", country: "South Africa", lat: -33.92, lng: 18.42 },
  { name: "Accra", country: "Ghana", lat: 5.6, lng: -0.19 },
  { name: "Casablanca", country: "Morocco", lat: 33.57, lng: -7.59 },
  { name: "Addis Ababa", country: "Ethiopia", lat: 9.03, lng: 38.74 },
  { name: "Dakar", country: "Senegal", lat: 14.72, lng: -17.47 },
  { name: "Tunis", country: "Tunisia", lat: 36.81, lng: 10.18 },
  { name: "Algiers", country: "Algeria", lat: 36.75, lng: 3.06 },

  // Americas — North
  { name: "New York", country: "USA", lat: 40.71, lng: -74.0 },
  { name: "Los Angeles", country: "USA", lat: 34.05, lng: -118.24 },
  { name: "Chicago", country: "USA", lat: 41.88, lng: -87.63 },
  { name: "San Francisco", country: "USA", lat: 37.77, lng: -122.42 },
  { name: "Seattle", country: "USA", lat: 47.61, lng: -122.33 },
  { name: "Austin", country: "USA", lat: 30.27, lng: -97.74 },
  { name: "Miami", country: "USA", lat: 25.76, lng: -80.19 },
  { name: "Boston", country: "USA", lat: 42.36, lng: -71.06 },
  { name: "Denver", country: "USA", lat: 39.74, lng: -104.99 },
  { name: "Atlanta", country: "USA", lat: 33.75, lng: -84.39 },
  { name: "Washington, D.C.", country: "USA", lat: 38.91, lng: -77.04 },
  { name: "Houston", country: "USA", lat: 29.76, lng: -95.37 },
  { name: "Dallas", country: "USA", lat: 32.78, lng: -96.8 },
  { name: "Phoenix", country: "USA", lat: 33.45, lng: -112.07 },
  { name: "Minneapolis", country: "USA", lat: 44.98, lng: -93.27 },
  { name: "Portland", country: "USA", lat: 45.52, lng: -122.68 },
  { name: "Toronto", country: "Canada", lat: 43.65, lng: -79.38 },
  { name: "Montreal", country: "Canada", lat: 45.5, lng: -73.57 },
  { name: "Vancouver", country: "Canada", lat: 49.28, lng: -123.12 },
  { name: "Ottawa", country: "Canada", lat: 45.42, lng: -75.7 },
  { name: "Calgary", country: "Canada", lat: 51.04, lng: -114.07 },
  { name: "Mexico City", country: "Mexico", lat: 19.43, lng: -99.13 },
  { name: "Guadalajara", country: "Mexico", lat: 20.67, lng: -103.34 },
  { name: "Monterrey", country: "Mexico", lat: 25.69, lng: -100.32 },

  // Americas — Central & Caribbean
  { name: "San José", country: "Costa Rica", lat: 9.93, lng: -84.08 },
  { name: "Panama City", country: "Panama", lat: 8.98, lng: -79.52 },
  { name: "Havana", country: "Cuba", lat: 23.13, lng: -82.38 },
  { name: "San Juan", country: "Puerto Rico", lat: 18.47, lng: -66.11 },

  // Americas — South
  { name: "São Paulo", country: "Brazil", lat: -23.55, lng: -46.63 },
  { name: "Rio de Janeiro", country: "Brazil", lat: -22.91, lng: -43.17 },
  { name: "Brasília", country: "Brazil", lat: -15.78, lng: -47.93 },
  { name: "Buenos Aires", country: "Argentina", lat: -34.6, lng: -58.38 },
  { name: "Santiago", country: "Chile", lat: -33.45, lng: -70.67 },
  { name: "Lima", country: "Peru", lat: -12.05, lng: -77.04 },
  { name: "Bogotá", country: "Colombia", lat: 4.71, lng: -74.07 },
  { name: "Medellín", country: "Colombia", lat: 6.24, lng: -75.58 },
  { name: "Caracas", country: "Venezuela", lat: 10.5, lng: -66.92 },
  { name: "Quito", country: "Ecuador", lat: -0.18, lng: -78.47 },
  { name: "Montevideo", country: "Uruguay", lat: -34.9, lng: -56.16 },
  { name: "Asunción", country: "Paraguay", lat: -25.28, lng: -57.63 },
  { name: "La Paz", country: "Bolivia", lat: -16.5, lng: -68.15 },

  // Asia — East
  { name: "Tokyo", country: "Japan", lat: 35.68, lng: 139.69 },
  { name: "Osaka", country: "Japan", lat: 34.69, lng: 135.5 },
  { name: "Kyoto", country: "Japan", lat: 35.01, lng: 135.77 },
  { name: "Seoul", country: "South Korea", lat: 37.57, lng: 126.98 },
  { name: "Busan", country: "South Korea", lat: 35.18, lng: 129.08 },
  { name: "Beijing", country: "China", lat: 39.9, lng: 116.4 },
  { name: "Shanghai", country: "China", lat: 31.23, lng: 121.47 },
  { name: "Shenzhen", country: "China", lat: 22.54, lng: 114.06 },
  { name: "Guangzhou", country: "China", lat: 23.13, lng: 113.26 },
  { name: "Hong Kong", country: "Hong Kong SAR", lat: 22.32, lng: 114.17 },
  { name: "Taipei", country: "Taiwan", lat: 25.03, lng: 121.57 },

  // Asia — Southeast
  { name: "Singapore", country: "Singapore", lat: 1.35, lng: 103.82 },
  { name: "Bangkok", country: "Thailand", lat: 13.76, lng: 100.5 },
  { name: "Chiang Mai", country: "Thailand", lat: 18.79, lng: 98.99 },
  { name: "Kuala Lumpur", country: "Malaysia", lat: 3.14, lng: 101.69 },
  { name: "Jakarta", country: "Indonesia", lat: -6.21, lng: 106.85 },
  { name: "Bali (Denpasar)", country: "Indonesia", lat: -8.65, lng: 115.22 },
  { name: "Manila", country: "Philippines", lat: 14.6, lng: 120.98 },
  { name: "Cebu", country: "Philippines", lat: 10.32, lng: 123.9 },
  { name: "Ho Chi Minh City", country: "Vietnam", lat: 10.78, lng: 106.7 },
  { name: "Hanoi", country: "Vietnam", lat: 21.03, lng: 105.85 },
  { name: "Phnom Penh", country: "Cambodia", lat: 11.56, lng: 104.92 },
  { name: "Yangon", country: "Myanmar", lat: 16.84, lng: 96.17 },

  // Asia — South
  { name: "Mumbai", country: "India", lat: 19.08, lng: 72.88 },
  { name: "Delhi", country: "India", lat: 28.61, lng: 77.21 },
  { name: "Bangalore", country: "India", lat: 12.97, lng: 77.59 },
  { name: "Chennai", country: "India", lat: 13.08, lng: 80.27 },
  { name: "Kolkata", country: "India", lat: 22.57, lng: 88.36 },
  { name: "Hyderabad", country: "India", lat: 17.39, lng: 78.49 },
  { name: "Karachi", country: "Pakistan", lat: 24.86, lng: 67.0 },
  { name: "Lahore", country: "Pakistan", lat: 31.55, lng: 74.34 },
  { name: "Islamabad", country: "Pakistan", lat: 33.69, lng: 73.05 },
  { name: "Dhaka", country: "Bangladesh", lat: 23.81, lng: 90.41 },
  { name: "Colombo", country: "Sri Lanka", lat: 6.93, lng: 79.86 },
  { name: "Kathmandu", country: "Nepal", lat: 27.72, lng: 85.32 },

  // Asia — Central / Western
  { name: "Tashkent", country: "Uzbekistan", lat: 41.31, lng: 69.24 },
  { name: "Almaty", country: "Kazakhstan", lat: 43.24, lng: 76.93 },
  { name: "Tbilisi", country: "Georgia", lat: 41.72, lng: 44.79 },
  { name: "Yerevan", country: "Armenia", lat: 40.18, lng: 44.51 },
  { name: "Baku", country: "Azerbaijan", lat: 40.41, lng: 49.87 },
  { name: "Tehran", country: "Iran", lat: 35.69, lng: 51.39 },
  { name: "Istanbul", country: "Turkey", lat: 41.01, lng: 28.98 },
  { name: "Ankara", country: "Turkey", lat: 39.93, lng: 32.86 },
  { name: "Dubai", country: "UAE", lat: 25.2, lng: 55.27 },
  { name: "Abu Dhabi", country: "UAE", lat: 24.47, lng: 54.37 },
  { name: "Doha", country: "Qatar", lat: 25.29, lng: 51.53 },
  { name: "Riyadh", country: "Saudi Arabia", lat: 24.71, lng: 46.68 },
  { name: "Jeddah", country: "Saudi Arabia", lat: 21.49, lng: 39.19 },
  { name: "Tel Aviv", country: "Israel", lat: 32.08, lng: 34.78 },
  { name: "Jerusalem", country: "Israel", lat: 31.78, lng: 35.22 },
  { name: "Amman", country: "Jordan", lat: 31.95, lng: 35.93 },
  { name: "Beirut", country: "Lebanon", lat: 33.89, lng: 35.5 },

  // Europe — West
  { name: "London", country: "UK", lat: 51.51, lng: -0.13 },
  { name: "Manchester", country: "UK", lat: 53.48, lng: -2.24 },
  { name: "Edinburgh", country: "UK", lat: 55.95, lng: -3.19 },
  { name: "Dublin", country: "Ireland", lat: 53.35, lng: -6.26 },
  { name: "Paris", country: "France", lat: 48.86, lng: 2.35 },
  { name: "Lyon", country: "France", lat: 45.76, lng: 4.83 },
  { name: "Marseille", country: "France", lat: 43.3, lng: 5.37 },
  { name: "Amsterdam", country: "Netherlands", lat: 52.37, lng: 4.9 },
  { name: "Rotterdam", country: "Netherlands", lat: 51.92, lng: 4.48 },
  { name: "Brussels", country: "Belgium", lat: 50.85, lng: 4.35 },
  { name: "Luxembourg", country: "Luxembourg", lat: 49.61, lng: 6.13 },

  // Europe — Central
  { name: "Berlin", country: "Germany", lat: 52.52, lng: 13.4 },
  { name: "Munich", country: "Germany", lat: 48.14, lng: 11.58 },
  { name: "Hamburg", country: "Germany", lat: 53.55, lng: 10.0 },
  { name: "Frankfurt", country: "Germany", lat: 50.11, lng: 8.68 },
  { name: "Cologne", country: "Germany", lat: 50.94, lng: 6.96 },
  { name: "Vienna", country: "Austria", lat: 48.21, lng: 16.37 },
  { name: "Zurich", country: "Switzerland", lat: 47.38, lng: 8.54 },
  { name: "Geneva", country: "Switzerland", lat: 46.2, lng: 6.15 },
  { name: "Prague", country: "Czechia", lat: 50.08, lng: 14.44 },
  { name: "Warsaw", country: "Poland", lat: 52.23, lng: 21.01 },
  { name: "Krakow", country: "Poland", lat: 50.06, lng: 19.94 },
  { name: "Budapest", country: "Hungary", lat: 47.5, lng: 19.04 },
  { name: "Bratislava", country: "Slovakia", lat: 48.15, lng: 17.11 },
  { name: "Ljubljana", country: "Slovenia", lat: 46.06, lng: 14.51 },

  // Europe — Southern
  { name: "Madrid", country: "Spain", lat: 40.42, lng: -3.7 },
  { name: "Barcelona", country: "Spain", lat: 41.39, lng: 2.17 },
  { name: "Valencia", country: "Spain", lat: 39.47, lng: -0.38 },
  { name: "Lisbon", country: "Portugal", lat: 38.72, lng: -9.14 },
  { name: "Porto", country: "Portugal", lat: 41.15, lng: -8.61 },
  { name: "Rome", country: "Italy", lat: 41.9, lng: 12.5 },
  { name: "Milan", country: "Italy", lat: 45.46, lng: 9.19 },
  { name: "Naples", country: "Italy", lat: 40.85, lng: 14.27 },
  { name: "Turin", country: "Italy", lat: 45.07, lng: 7.69 },
  { name: "Athens", country: "Greece", lat: 37.98, lng: 23.73 },
  { name: "Belgrade", country: "Serbia", lat: 44.79, lng: 20.45 },
  { name: "Zagreb", country: "Croatia", lat: 45.81, lng: 15.98 },
  { name: "Sofia", country: "Bulgaria", lat: 42.7, lng: 23.32 },
  { name: "Bucharest", country: "Romania", lat: 44.43, lng: 26.1 },

  // Europe — Northern
  { name: "Stockholm", country: "Sweden", lat: 59.33, lng: 18.07 },
  { name: "Gothenburg", country: "Sweden", lat: 57.71, lng: 11.97 },
  { name: "Oslo", country: "Norway", lat: 59.91, lng: 10.75 },
  { name: "Copenhagen", country: "Denmark", lat: 55.68, lng: 12.57 },
  { name: "Helsinki", country: "Finland", lat: 60.17, lng: 24.94 },
  { name: "Reykjavík", country: "Iceland", lat: 64.15, lng: -21.94 },
  { name: "Tallinn", country: "Estonia", lat: 59.44, lng: 24.75 },
  { name: "Riga", country: "Latvia", lat: 56.95, lng: 24.11 },
  { name: "Vilnius", country: "Lithuania", lat: 54.69, lng: 25.28 },

  // Europe — Eastern
  { name: "Moscow", country: "Russia", lat: 55.75, lng: 37.62 },
  { name: "Saint Petersburg", country: "Russia", lat: 59.93, lng: 30.34 },
  { name: "Kyiv", country: "Ukraine", lat: 50.45, lng: 30.52 },
  { name: "Minsk", country: "Belarus", lat: 53.9, lng: 27.57 },

  // Oceania
  { name: "Sydney", country: "Australia", lat: -33.87, lng: 151.21 },
  { name: "Melbourne", country: "Australia", lat: -37.81, lng: 144.96 },
  { name: "Brisbane", country: "Australia", lat: -27.47, lng: 153.03 },
  { name: "Perth", country: "Australia", lat: -31.95, lng: 115.86 },
  { name: "Adelaide", country: "Australia", lat: -34.93, lng: 138.6 },
  { name: "Auckland", country: "New Zealand", lat: -36.85, lng: 174.76 },
  { name: "Wellington", country: "New Zealand", lat: -41.29, lng: 174.78 },
  { name: "Christchurch", country: "New Zealand", lat: -43.53, lng: 172.64 },
  { name: "Honolulu", country: "USA", lat: 21.31, lng: -157.86 },
];

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export function searchRegions(query: string, limit = 50): Region[] {
  const q = norm(query.trim());
  if (!q) return REGIONS.slice(0, limit);
  const matches = REGIONS.filter((r) => {
    const hay = `${norm(r.name)} ${norm(r.country)}`;
    return hay.includes(q);
  });
  matches.sort((a, b) => {
    const an = norm(a.name).startsWith(q) ? 0 : 1;
    const bn = norm(b.name).startsWith(q) ? 0 : 1;
    if (an !== bn) return an - bn;
    return a.name.localeCompare(b.name);
  });
  return matches.slice(0, limit);
}
