const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_BATCH_SIZE = 10;
const MIN_CONFIDENCE = 70;

/*
  Broad UK business-sector rotation.

  "All UK Businesses" performs a broad Hunter search.
  The remaining sectors ensure scheduled runs also explore
  specific industries rather than repeatedly returning the
  same general search results.
*/
const BUSINESS_TYPES = [
  "All UK Businesses",
  "Restaurants",
  "Cafes",
  "Hotels",
  "Estate Agents",
  "Letting Agents",
  "Accountants",
  "Solicitors",
  "Financial Advisers",
  "Insurance Brokers",
  "Mortgage Brokers",
  "Recruitment Agencies",
  "Business Consultants",
  "Marketing Agencies",
  "Web Design Agencies",
  "IT Services",
  "Computer Repair",
  "Car Valeting",
  "Car Dealers",
  "Garages",
  "MOT Centres",
  "Tyre Shops",
  "Vehicle Repair",
  "Plumbers",
  "Electricians",
  "Builders",
  "Roofers",
  "Painters and Decorators",
  "Carpenters",
  "Joiners",
  "Landscaping",
  "Gardeners",
  "Cleaning Companies",
  "Window Cleaners",
  "Pest Control",
  "Security Companies",
  "Removal Companies",
  "Storage Companies
