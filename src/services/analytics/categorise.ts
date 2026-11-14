/**
 * Transaction categorisation.
 *
 * Open Banking data gives us several weak-to-strong signals for what a
 * transaction actually was, and none is reliable on its own:
 *   - `merchant_name`      — enriched merchant, when the bank/TrueLayer provides it
 *   - `merchant_category_code` (MCC) — the ISO 18245 code the card network assigns
 *   - `transaction_classification`   — TrueLayer's own spending taxonomy (an array)
 *   - `description`        — the raw statement line, often full of bank noise
 *
 * NB TrueLayer's `transaction_category` is a payment TYPE (PURCHASE, DIRECT_DEBIT,
 * TRANSFER…), NOT a spending category, so it's useless for this and handled
 * elsewhere. `inferCategory` combines the signals above, most-precise first, so
 * real spending lands in a sensible bucket instead of "other".
 *
 * Shared with the free-text query parser so "how much on groceries" and the
 * stored category agree.
 */

const MERCHANT_CATEGORY_RULES: Array<[RegExp, string]> = [
  [/tesco|sainsbury|waitrose|lidl|aldi|morrison|asda|co-?op|iceland|ocado|marks\s*&?\s*spencer|m&s\s*(food|simply)|budgens|spar|farmfoods|costcutter|nisa|whole\s*foods|booths/i, 'groceries'],
  [/deliveroo|uber\s*eats|just\s*eat|mcdonald|kfc|nando|greggs|pret|costa|starbucks|caffe\s*nero|burger\s*king|subway|dominos|pizza|restaurant|cafe|coffee|wagamama|five\s*guys|itsu|leon|wasabi|\btgi\b|pizza\s*express|frankie|harvester|toby\s*carvery|zizzi|\bgail'?s\b|chopstix|tortilla|honest\s*burger/i, 'restaurants'],
  [/\buber\b|\bbolt\b|\btfl\b|trainline|national\s*rail|\blner\b|\bgwr\b|avanti|northern\s*rail|oyster|addison\s*lee|taxi|minicab|parking|\bncp\b|ringo|justpark|petrol|\bshell\b|\bbp\b|\besso\b|texaco|\bgulf\b|\bjet\b|morrisons\s*petrol|sainsbury'?s\s*petrol|\bfuel\b|\bev\b\s*charg|pod\s*point|congestion\s*charge|dart\s*charge|\bdvla\b/i, 'transport'],
  [/netflix|spotify|disney\+?|disney\s*plus|amazon\s*prime|prime\s*video|apple\.com\/bill|apple\s*tv|itunes|youtube\s*premium|now\s*tv|\bnowtv\b|audible|icloud|google\s*(storage|one)|dropbox|patreon|substack|canva|adobe|microsoft\s*365|office\s*365|linkedin\s*premium|\bgym\b|puregym|the\s*gym\b|\bpayg\b\s*gym|fitness\s*first|david\s*lloyd|nuffield|virgin\s*active|membership/i, 'subscriptions'],
  [/amazon(?!\s*prime)|asos|ebay|\bnext\b|zara|h&m|primark|john\s*lewis|argos|currys|boots|superdrug|ikea|b&q|screwfix|wickes|homebase|dunelm|the\s*range|wilko|poundland|home\s*bargains|b&m\b|wh\s*smith|\btk\s*maxx\b|matalan|decathlon|halfords|etsy|aliexpress|shein|temu|\bnike\b|adidas|sports\s*direct|jd\s*sports|footlocker|very\.co|littlewoods|vinted|depop|\bikea\b/i, 'shopping'],
  [/british\s*gas|octopus\s*energy|edf|\beon\b|e\.on|\bovo\b|scottish\s*power|\bsse\b|bulb|utilita|shell\s*energy|so\s*energy|thames\s*water|anglian\s*water|severn\s*trent|united\s*utilities|yorkshire\s*water|southern\s*water|south\s*east\s*water|wessex\s*water|affinity\s*water|council\s*tax|tv\s*licen|vodafone|\bo2\b|\bee\b|three\b|giffgaff|tesco\s*mobile|sky\s*mobile|lebara|lyca|\bid\s*mobile\b|virgin\s*media|\bbt\b|\bsky\b|talktalk|plusnet|hyperoptic|community\s*fibre|\bnow\s*broadband\b/i, 'bills'],
  [/pharmacy|lloyds\s*pharmacy|dentist|dental|optician|specsavers|vision\s*express|\bnhs\b|bupa|boots\s*opticians|well\s*pharmacy/i, 'health'],
  [/cinema|odeon|\bvue\b|cineworld|picturehouse|theatre|ticketmaster|eventbrite|see\s*tickets|concert|\bsteam\b|playstation|\bxbox\b|nintendo|\btwitch\b|national\s*trust|english\s*heritage/i, 'entertainment'],
  [/airbnb|booking\.com|expedia|hotels?\.com|ryanair|easyjet|british\s*airways|\bba\.com\b|jet2|\btui\b|wizz\s*air|\bklm\b|lufthansa|emirates|hotel|premier\s*inn|travelodge|\bhostel\b|\bflight|eurostar|p&o\s*ferries|\bhertz\b|\bavis\b|enterprise\s*rent/i, 'travel'],
  [/\brent\b|mortgage|landlord|letting|\bhalifax\s*mort|nationwide\s*mort/i, 'rent'],
  [/\bpub\b|\bbar\b|wetherspoon|\bjd\s*wetherspoon\b|brewdog|\bwine\b|\bbeer\b|majestic\s*wine|bottle\s*shop|off\s*licence|\bbrewery\b|greene\s*king|\bstonegate\b/i, 'drinking'],
  [/aviva|\baxa\b|admiral|direct\s*line|hastings|churchill|\blv=?\b|legal\s*&?\s*general|\bvitality\b|more\s*th>n|insurance|insure/i, 'insurance'],
  [/justgiving|gofundme|oxfam|cancer\s*research|british\s*red\s*cross|\bunicef\b|\bnspcc\b|\brspca\b|comic\s*relief|macmillan|marie\s*curie|\bshelter\b|charity|donation|\bchurch\b|\bchapel\b|\bmosque\b|\bparish\b|tithe/i, 'charity'],
  [/paypal|klarna|clearpay|laybuy|zilch|\blaybuy\b/i, 'shopping'],
]

/**
 * TrueLayer's `transaction_classification` taxonomy → our category.
 * More specific labels first (a "Groceries" sub-label beats "Food & Dining").
 */
const CLASSIFICATION_RULES: Array<[RegExp, string]> = [
  [/grocer|supermarket/i, 'groceries'],
  [/fast\s*food|restaurant|food\s*&?\s*(and\s*)?dining|dining|takeaway|coffee\s*shop/i, 'restaurants'],
  [/bars?\s*&?\s*(and\s*)?nightlife|\balcohol\b|pubs?\b/i, 'drinking'],
  [/gas\s*&?\s*(and\s*)?fuel|\bfuel\b|petrol|service\s*station/i, 'transport'],
  [/auto\s*&?\s*(and\s*)?transport|public\s*transport|ride\s*share|parking|\btaxi\b|transport/i, 'transport'],
  [/air\s*travel|\btravel\b|hotel|accommodation|vacation|holiday/i, 'travel'],
  [/mobile\s*phone|\binternet\b|television|bills?\s*&?\s*(and\s*)?utilities|utilities|\bwater\b|\benergy\b/i, 'bills'],
  [/gifts?\s*&?\s*(and\s*)?donations?|charity|charitable|donation/i, 'charity'],
  [/health\s*&?\s*(and\s*)?fitness|\bgym\b|\bdoctor\b|pharmacy|dentist|medical/i, 'health'],
  [/entertainment|movies|\bmusic\b|\bgames?\b|streaming/i, 'entertainment'],
  [/personal\s*care/i, 'health'],
  [/\brent\b|mortgage/i, 'rent'],
  [/insurance/i, 'insurance'],
  [/subscription/i, 'subscriptions'],
  [/clothing|electronics|department\s*store|home\s*improvement|furnishings|\bshopping\b|merchandise/i, 'shopping'],
]

/**
 * Merchant Category Code (ISO 18245) → our category. The card network assigns
 * these, so they're a reliable fallback when we don't recognise the name.
 */
const MCC_CATEGORY: Record<string, string> = {
  // Groceries / food stores
  5411: 'groceries', 5422: 'groceries', 5441: 'groceries', 5451: 'groceries', 5462: 'groceries', 5499: 'groceries',
  // Restaurants & fast food
  5811: 'restaurants', 5812: 'restaurants', 5814: 'restaurants',
  // Bars / pubs
  5813: 'drinking',
  // Fuel & transport
  5541: 'transport', 5542: 'transport', 5983: 'transport',
  4111: 'transport', 4112: 'transport', 4121: 'transport', 4131: 'transport',
  4784: 'transport', 7523: 'transport', 7512: 'transport', 7513: 'transport', 7538: 'transport', 7549: 'transport',
  // Travel
  3000: 'travel', 4411: 'travel', 4511: 'travel', 4722: 'travel', 7011: 'travel',
  // Health & medical
  5912: 'health', 8011: 'health', 8021: 'health', 8031: 'health', 8042: 'health', 8043: 'health', 8049: 'health', 8062: 'health', 8071: 'health', 8099: 'health',
  // Retail / shopping
  5200: 'shopping', 5211: 'shopping', 5231: 'shopping', 5251: 'shopping', 5261: 'shopping', 5311: 'shopping', 5331: 'shopping', 5399: 'shopping',
  5611: 'shopping', 5621: 'shopping', 5631: 'shopping', 5641: 'shopping', 5651: 'shopping', 5655: 'shopping', 5661: 'shopping', 5691: 'shopping', 5699: 'shopping',
  5712: 'shopping', 5719: 'shopping', 5722: 'shopping', 5732: 'shopping', 5733: 'shopping', 5734: 'shopping', 5735: 'shopping',
  5942: 'shopping', 5943: 'shopping', 5944: 'shopping', 5945: 'shopping', 5946: 'shopping', 5947: 'shopping', 5977: 'shopping', 5999: 'shopping',
  // Bills / utilities / telecom
  4812: 'bills', 4814: 'bills', 4899: 'bills', 4900: 'bills', 4902: 'bills',
  // Entertainment
  5815: 'entertainment', 5816: 'entertainment', 5817: 'entertainment', 5818: 'entertainment',
  7832: 'entertainment', 7922: 'entertainment', 7929: 'entertainment', 7941: 'entertainment', 7991: 'entertainment', 7996: 'entertainment', 7998: 'entertainment', 7999: 'entertainment',
  // Memberships / subscriptions
  7997: 'subscriptions', 5968: 'subscriptions',
  // Insurance
  5960: 'insurance', 6300: 'insurance',
  // Charity / religious
  8398: 'charity', 8661: 'charity',
}

/**
 * Strips common bank/statement noise so the real merchant token is exposed to
 * the merchant rules. "CARD PAYMENT TO TESCO STORES 2847 ON 05 NOV" → "tesco
 * stores".
 */
export function normaliseDescription(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .replace(/\b(card\s*payment\s*to|payment\s*to|card\s*purchase|purchase\s*at|pos\s*purchase|contactless\s*payment|direct\s*debit|standing\s*order|faster\s*payment|bank\s*giro\s*credit|\bbgc\b|\bpos\b|\bvis\b|\bvisa\b|mastercard|\bdd\b|\bso\b|\bftp\b|\bchq\b|\bref\b|\bcrd\b)\b/g, ' ')
    .replace(/\b\d{2}[/-]\d{2}([/-]\d{2,4})?\b/g, ' ') // dates
    .replace(/\bx{2,}\d{2,}\b/g, ' ') // masked card numbers
    .replace(/\b\d{6,}\b/g, ' ') // long reference numbers
    .replace(/[*#]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Infers a spending category from a merchant name / description, or returns
 * undefined when nothing matches confidently.
 */
export function categoriseByMerchant(text: string | null | undefined): string | undefined {
  if (!text) return undefined
  for (const [pattern, category] of MERCHANT_CATEGORY_RULES) {
    if (pattern.test(text)) return category
  }
  return undefined
}

function classifyByTaxonomy(classification: string | null | undefined): string | undefined {
  if (!classification) return undefined
  for (const [pattern, category] of CLASSIFICATION_RULES) {
    if (pattern.test(classification)) return category
  }
  return undefined
}

/**
 * Combines every available signal, most-precise first:
 *   1. known merchant name  2. MCC code  3. TrueLayer classification
 *   4. de-noised description
 */
export function inferCategory(input: {
  merchantName?: string | null | undefined
  description?: string | null | undefined
  classification?: string[] | string | null | undefined
  mcc?: string | null | undefined
}): string | undefined {
  const byMerchant = categoriseByMerchant(input.merchantName)
  if (byMerchant) return byMerchant

  const mcc = input.mcc?.trim()
  if (mcc && MCC_CATEGORY[mcc]) return MCC_CATEGORY[mcc]

  const classStr = Array.isArray(input.classification)
    ? input.classification.join(' ')
    : input.classification
  const byClass = classifyByTaxonomy(classStr)
  if (byClass) return byClass

  return categoriseByMerchant(normaliseDescription(input.description))
}
