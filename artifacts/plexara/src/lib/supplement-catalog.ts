export interface CatalogSupplement {
  name: string;
  category: "vitamin" | "mineral" | "omega" | "amino-acid" | "herb" | "probiotic" | "antioxidant" | "hormone" | "other";
  defaultDosage?: string;
  defaultFrequency?: string;
  aliases?: string[];
}

export const SUPPLEMENT_CATALOG: CatalogSupplement[] = [
  { name: "Vitamin A", category: "vitamin", defaultDosage: "5000 IU", defaultFrequency: "daily", aliases: ["retinol", "retinyl palmitate"] },
  { name: "Vitamin B1 (Thiamine)", category: "vitamin", defaultDosage: "100 mg", defaultFrequency: "daily", aliases: ["thiamine", "thiamin"] },
  { name: "Vitamin B2 (Riboflavin)", category: "vitamin", defaultDosage: "100 mg", defaultFrequency: "daily", aliases: ["riboflavin"] },
  { name: "Vitamin B3 (Niacin)", category: "vitamin", defaultDosage: "500 mg", defaultFrequency: "daily", aliases: ["niacin", "nicotinic acid", "niacinamide"] },
  { name: "Vitamin B5 (Pantothenic Acid)", category: "vitamin", defaultDosage: "500 mg", defaultFrequency: "daily", aliases: ["pantothenic acid", "pantothenate"] },
  { name: "Vitamin B6 (Pyridoxine)", category: "vitamin", defaultDosage: "50 mg", defaultFrequency: "daily", aliases: ["pyridoxine", "p5p", "pyridoxal-5-phosphate"] },
  { name: "Vitamin B7 (Biotin)", category: "vitamin", defaultDosage: "5000 mcg", defaultFrequency: "daily", aliases: ["biotin"] },
  { name: "Vitamin B9 (Folate)", category: "vitamin", defaultDosage: "400 mcg", defaultFrequency: "daily", aliases: ["folate", "folic acid", "methylfolate", "5-MTHF"] },
  { name: "Vitamin B12 (Methylcobalamin)", category: "vitamin", defaultDosage: "1000 mcg", defaultFrequency: "daily", aliases: ["b12", "methylcobalamin", "cyanocobalamin", "hydroxocobalamin"] },
  { name: "Vitamin C", category: "vitamin", defaultDosage: "1000 mg", defaultFrequency: "daily", aliases: ["ascorbic acid", "ascorbate"] },
  { name: "Vitamin D3", category: "vitamin", defaultDosage: "2000 IU", defaultFrequency: "daily", aliases: ["cholecalciferol", "vitamin d", "d3"] },
  { name: "Vitamin E", category: "vitamin", defaultDosage: "200 IU", defaultFrequency: "daily", aliases: ["tocopherol", "alpha-tocopherol", "tocotrienol"] },
  { name: "Vitamin K2 (MK-7)", category: "vitamin", defaultDosage: "100 mcg", defaultFrequency: "daily", aliases: ["mk-7", "menaquinone", "vitamin k2"] },
  { name: "Vitamin K1", category: "vitamin", defaultDosage: "100 mcg", defaultFrequency: "daily", aliases: ["phylloquinone"] },
  { name: "B-Complex", category: "vitamin", defaultDosage: "1 capsule", defaultFrequency: "daily", aliases: ["b complex", "vitamin b complex"] },
  { name: "Multivitamin", category: "vitamin", defaultDosage: "1 tablet", defaultFrequency: "daily", aliases: ["multi", "daily multi"] },

  { name: "Magnesium Glycinate", category: "mineral", defaultDosage: "400 mg", defaultFrequency: "daily", aliases: ["magnesium bisglycinate", "mag glycinate"] },
  { name: "Magnesium Citrate", category: "mineral", defaultDosage: "400 mg", defaultFrequency: "daily", aliases: ["mag citrate"] },
  { name: "Magnesium Threonate", category: "mineral", defaultDosage: "2000 mg", defaultFrequency: "daily", aliases: ["mag threonate", "magtein"] },
  { name: "Magnesium Malate", category: "mineral", defaultDosage: "1250 mg", defaultFrequency: "daily" },
  { name: "Zinc Picolinate", category: "mineral", defaultDosage: "30 mg", defaultFrequency: "daily", aliases: ["zinc"] },
  { name: "Zinc Bisglycinate", category: "mineral", defaultDosage: "30 mg", defaultFrequency: "daily" },
  { name: "Iron Bisglycinate", category: "mineral", defaultDosage: "25 mg", defaultFrequency: "daily", aliases: ["iron", "ferrous bisglycinate"] },
  { name: "Iron Sulfate", category: "mineral", defaultDosage: "65 mg", defaultFrequency: "daily", aliases: ["ferrous sulfate"] },
  { name: "Calcium Citrate", category: "mineral", defaultDosage: "500 mg", defaultFrequency: "twice daily", aliases: ["calcium"] },
  { name: "Selenium", category: "mineral", defaultDosage: "200 mcg", defaultFrequency: "daily", aliases: ["selenomethionine"] },
  { name: "Iodine", category: "mineral", defaultDosage: "150 mcg", defaultFrequency: "daily", aliases: ["potassium iodide", "kelp"] },
  { name: "Chromium Picolinate", category: "mineral", defaultDosage: "200 mcg", defaultFrequency: "daily", aliases: ["chromium"] },
  { name: "Copper", category: "mineral", defaultDosage: "2 mg", defaultFrequency: "daily" },
  { name: "Manganese", category: "mineral", defaultDosage: "5 mg", defaultFrequency: "daily" },
  { name: "Boron", category: "mineral", defaultDosage: "3 mg", defaultFrequency: "daily" },
  { name: "Lithium Orotate", category: "mineral", defaultDosage: "5 mg", defaultFrequency: "daily" },
  { name: "Potassium", category: "mineral", defaultDosage: "99 mg", defaultFrequency: "daily" },

  { name: "Omega-3 Fish Oil", category: "omega", defaultDosage: "2000 mg", defaultFrequency: "daily", aliases: ["fish oil", "epa dha", "epa/dha"] },
  { name: "Krill Oil", category: "omega", defaultDosage: "1000 mg", defaultFrequency: "daily" },
  { name: "Algae Oil (Vegan Omega-3)", category: "omega", defaultDosage: "500 mg", defaultFrequency: "daily", aliases: ["algal oil", "vegan dha"] },
  { name: "Cod Liver Oil", category: "omega", defaultDosage: "5 ml", defaultFrequency: "daily" },
  { name: "Flaxseed Oil", category: "omega", defaultDosage: "1000 mg", defaultFrequency: "daily" },
  { name: "Borage Oil", category: "omega", defaultDosage: "1000 mg", defaultFrequency: "daily", aliases: ["gla", "gamma-linolenic acid"] },

  { name: "Creatine Monohydrate", category: "amino-acid", defaultDosage: "5 g", defaultFrequency: "daily", aliases: ["creatine"] },
  { name: "L-Glutamine", category: "amino-acid", defaultDosage: "5 g", defaultFrequency: "daily", aliases: ["glutamine"] },
  { name: "L-Theanine", category: "amino-acid", defaultDosage: "200 mg", defaultFrequency: "daily", aliases: ["theanine"] },
  { name: "L-Tyrosine", category: "amino-acid", defaultDosage: "500 mg", defaultFrequency: "daily", aliases: ["tyrosine"] },
  { name: "L-Carnitine", category: "amino-acid", defaultDosage: "1000 mg", defaultFrequency: "daily", aliases: ["acetyl-l-carnitine", "alcar", "carnitine"] },
  { name: "L-Arginine", category: "amino-acid", defaultDosage: "3 g", defaultFrequency: "daily", aliases: ["arginine"] },
  { name: "L-Citrulline", category: "amino-acid", defaultDosage: "6 g", defaultFrequency: "daily", aliases: ["citrulline malate", "citrulline"] },
  { name: "Glycine", category: "amino-acid", defaultDosage: "3 g", defaultFrequency: "before bed" },
  { name: "Taurine", category: "amino-acid", defaultDosage: "1000 mg", defaultFrequency: "daily" },
  { name: "BCAA", category: "amino-acid", defaultDosage: "5 g", defaultFrequency: "daily", aliases: ["branched chain amino acids", "leucine isoleucine valine"] },
  { name: "Collagen Peptides", category: "amino-acid", defaultDosage: "10 g", defaultFrequency: "daily", aliases: ["collagen", "hydrolyzed collagen"] },
  { name: "Whey Protein", category: "amino-acid", defaultDosage: "25 g", defaultFrequency: "daily", aliases: ["whey isolate", "whey concentrate"] },

  { name: "Ashwagandha", category: "herb", defaultDosage: "600 mg", defaultFrequency: "daily", aliases: ["withania somnifera", "ksm-66"] },
  { name: "Rhodiola Rosea", category: "herb", defaultDosage: "400 mg", defaultFrequency: "daily", aliases: ["rhodiola"] },
  { name: "Turmeric (Curcumin)", category: "herb", defaultDosage: "1000 mg", defaultFrequency: "daily", aliases: ["curcumin", "turmeric", "meriva"] },
  { name: "Ginseng (Panax)", category: "herb", defaultDosage: "400 mg", defaultFrequency: "daily", aliases: ["panax ginseng", "korean ginseng", "asian ginseng"] },
  { name: "Ginkgo Biloba", category: "herb", defaultDosage: "120 mg", defaultFrequency: "daily", aliases: ["ginkgo"] },
  { name: "Milk Thistle", category: "herb", defaultDosage: "200 mg", defaultFrequency: "daily", aliases: ["silymarin"] },
  { name: "Saw Palmetto", category: "herb", defaultDosage: "320 mg", defaultFrequency: "daily" },
  { name: "Holy Basil (Tulsi)", category: "herb", defaultDosage: "300 mg", defaultFrequency: "daily", aliases: ["tulsi", "ocimum sanctum"] },
  { name: "Bacopa Monnieri", category: "herb", defaultDosage: "300 mg", defaultFrequency: "daily", aliases: ["bacopa"] },
  { name: "Lion's Mane", category: "herb", defaultDosage: "1000 mg", defaultFrequency: "daily", aliases: ["lions mane", "hericium erinaceus"] },
  { name: "Reishi", category: "herb", defaultDosage: "1000 mg", defaultFrequency: "daily", aliases: ["ganoderma lucidum"] },
  { name: "Cordyceps", category: "herb", defaultDosage: "1000 mg", defaultFrequency: "daily" },
  { name: "Chaga", category: "herb", defaultDosage: "1000 mg", defaultFrequency: "daily" },
  { name: "Maca Root", category: "herb", defaultDosage: "1500 mg", defaultFrequency: "daily", aliases: ["maca"] },
  { name: "Tribulus Terrestris", category: "herb", defaultDosage: "750 mg", defaultFrequency: "daily", aliases: ["tribulus"] },
  { name: "Berberine", category: "herb", defaultDosage: "500 mg", defaultFrequency: "three times daily" },
  { name: "Quercetin", category: "antioxidant", defaultDosage: "500 mg", defaultFrequency: "daily" },
  { name: "Resveratrol", category: "antioxidant", defaultDosage: "500 mg", defaultFrequency: "daily" },
  { name: "Astaxanthin", category: "antioxidant", defaultDosage: "12 mg", defaultFrequency: "daily" },
  { name: "Pycnogenol", category: "antioxidant", defaultDosage: "100 mg", defaultFrequency: "daily" },
  { name: "Green Tea Extract (EGCG)", category: "antioxidant", defaultDosage: "500 mg", defaultFrequency: "daily", aliases: ["egcg", "green tea"] },
  { name: "Grape Seed Extract", category: "antioxidant", defaultDosage: "200 mg", defaultFrequency: "daily" },

  { name: "Coenzyme Q10 (Ubiquinol)", category: "antioxidant", defaultDosage: "100 mg", defaultFrequency: "daily", aliases: ["coq10", "ubiquinol", "ubiquinone"] },
  { name: "Alpha Lipoic Acid (ALA)", category: "antioxidant", defaultDosage: "300 mg", defaultFrequency: "daily", aliases: ["ala", "alpha-lipoic acid"] },
  { name: "N-Acetyl Cysteine (NAC)", category: "antioxidant", defaultDosage: "600 mg", defaultFrequency: "twice daily", aliases: ["nac", "n-acetylcysteine"] },
  { name: "Glutathione (Liposomal)", category: "antioxidant", defaultDosage: "500 mg", defaultFrequency: "daily", aliases: ["gsh", "glutathione"] },
  { name: "PQQ", category: "antioxidant", defaultDosage: "20 mg", defaultFrequency: "daily", aliases: ["pyrroloquinoline quinone"] },
  { name: "Sulforaphane", category: "antioxidant", defaultDosage: "30 mg", defaultFrequency: "daily" },

  { name: "Probiotic (Multi-Strain)", category: "probiotic", defaultDosage: "50 billion CFU", defaultFrequency: "daily", aliases: ["probiotic", "lactobacillus", "bifidobacterium"] },
  { name: "Saccharomyces Boulardii", category: "probiotic", defaultDosage: "5 billion CFU", defaultFrequency: "daily", aliases: ["s. boulardii"] },
  { name: "Prebiotic Fiber (Psyllium)", category: "probiotic", defaultDosage: "5 g", defaultFrequency: "daily", aliases: ["psyllium husk", "psyllium"] },
  { name: "Inulin", category: "probiotic", defaultDosage: "5 g", defaultFrequency: "daily" },

  { name: "Melatonin", category: "hormone", defaultDosage: "0.5 mg", defaultFrequency: "before bed" },
  { name: "DHEA", category: "hormone", defaultDosage: "25 mg", defaultFrequency: "daily" },
  { name: "Pregnenolone", category: "hormone", defaultDosage: "30 mg", defaultFrequency: "daily" },

  { name: "NMN", category: "other", defaultDosage: "500 mg", defaultFrequency: "daily", aliases: ["nicotinamide mononucleotide"] },
  { name: "NR (Nicotinamide Riboside)", category: "other", defaultDosage: "300 mg", defaultFrequency: "daily", aliases: ["nicotinamide riboside", "nr"] },
  { name: "TMG (Trimethylglycine)", category: "other", defaultDosage: "1000 mg", defaultFrequency: "daily", aliases: ["betaine", "tmg", "trimethylglycine"] },
  { name: "Spermidine", category: "other", defaultDosage: "1 mg", defaultFrequency: "daily" },
  { name: "MSM", category: "other", defaultDosage: "1500 mg", defaultFrequency: "daily", aliases: ["methylsulfonylmethane"] },
  { name: "Glucosamine + Chondroitin", category: "other", defaultDosage: "1500 mg", defaultFrequency: "daily", aliases: ["glucosamine", "chondroitin"] },
  { name: "Hyaluronic Acid", category: "other", defaultDosage: "120 mg", defaultFrequency: "daily" },
  { name: "5-HTP", category: "other", defaultDosage: "100 mg", defaultFrequency: "daily", aliases: ["5-hydroxytryptophan"] },
  { name: "GABA", category: "other", defaultDosage: "500 mg", defaultFrequency: "before bed" },
  { name: "Phosphatidylserine", category: "other", defaultDosage: "300 mg", defaultFrequency: "daily" },
  { name: "Choline (Alpha-GPC)", category: "other", defaultDosage: "300 mg", defaultFrequency: "daily", aliases: ["alpha-gpc", "choline", "cdp-choline", "citicoline"] },
  { name: "Lecithin", category: "other", defaultDosage: "1200 mg", defaultFrequency: "daily", aliases: ["sunflower lecithin", "soy lecithin"] },
  { name: "Spirulina", category: "other", defaultDosage: "3 g", defaultFrequency: "daily" },
  { name: "Chlorella", category: "other", defaultDosage: "3 g", defaultFrequency: "daily" },
  { name: "Beetroot Extract", category: "other", defaultDosage: "500 mg", defaultFrequency: "daily", aliases: ["beet root", "nitric oxide booster"] },
  { name: "Apple Cider Vinegar", category: "other", defaultDosage: "15 ml", defaultFrequency: "daily", aliases: ["acv"] },
];

const CATEGORY_LABEL: Record<CatalogSupplement["category"], string> = {
  vitamin: "Vitamins",
  mineral: "Minerals",
  omega: "Omega & Fatty Acids",
  "amino-acid": "Amino Acids & Protein",
  herb: "Herbs & Adaptogens",
  probiotic: "Probiotics & Gut",
  antioxidant: "Antioxidants",
  hormone: "Hormones",
  other: "Other",
};

export function categoryLabel(c: CatalogSupplement["category"]): string {
  return CATEGORY_LABEL[c];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchCatalog(query: string, limit = 25): CatalogSupplement[] {
  const q = normalize(query);
  if (!q) return SUPPLEMENT_CATALOG.slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ s: CatalogSupplement; score: number }> = [];
  for (const s of SUPPLEMENT_CATALOG) {
    const nName = normalize(s.name);
    const nAliases = (s.aliases ?? []).map(normalize);
    const haystacks = [nName, ...nAliases];
    let score = 0;
    // Exact substring on full normalised query — strongest signal.
    if (nName.startsWith(q)) score = 100;
    else if (nName.includes(q)) score = 80;
    else if (nAliases.some((a) => a.startsWith(q))) score = 70;
    else if (nAliases.some((a) => a.includes(q))) score = 60;
    else {
      // Token-based fallback: every token in the query must appear (as a prefix
      // of any word) somewhere in the name OR any alias. Lets "vit d" find
      // "Vitamin D3" via tokens ["vit", "d"].
      const words = haystacks.flatMap((h) => h.split(/\s+/));
      const allTokensHit = tokens.every((t) =>
        words.some((w) => w.startsWith(t)),
      );
      if (allTokensHit) score = 50;
    }
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((x) => x.s);
}

export function findExactMatch(name: string): CatalogSupplement | null {
  const n = normalize(name);
  for (const s of SUPPLEMENT_CATALOG) {
    if (normalize(s.name) === n) return s;
    if ((s.aliases ?? []).some((a) => normalize(a) === n)) return s;
  }
  return null;
}
