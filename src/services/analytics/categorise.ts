/**
 * Merchant-name based categorisation fallback.
 *
 * Open Banking providers often return transactions with no usable spending
 * category (TrueLayer's `transaction_category` is a payment TYPE like PURCHASE
 * or DIRECT_DEBIT, not a spending category). When the provider category is
 * missing, we infer a sensible category from the merchant/description text so
 * spending breakdowns stay meaningful.
 *
 * Deliberately shared with the free-text query parser so a user asking
 * "how much on groceries" and the stored category agree.
 */

const MERCHANT_CATEGORY_RULES: Array<[RegExp, string]> = [
  [/tesco|sainsbury|waitrose|lidl|aldi|morrison|asda|co-?op|iceland|ocado|marks\s*&?\s*spencer|m&s\s*food|budgens|spar/i, 'groceries'],
  [/deliveroo|uber\s*eats|just\s*eat|mcdonald|kfc|nando|greggs|pret|costa|starbucks|caffe\s*nero|burger\s*king|subway|dominos|pizza|restaurant|cafe|coffee|wagamama|five\s*guys/i, 'restaurants'],
  [/\buber\b|\bbolt\b|\btfl\b|trainline|national\s*rail|\blner\b|\bgwr\b|oyster|addison\s*lee|taxi|parking|\bncp\b|petrol|\bshell\b|\bbp\b|\besso\b|texaco|\bfuel\b/i, 'transport'],
  [/netflix|spotify|disney|amazon\s*prime|apple\.com\/bill|apple\s*tv|youtube\s*premium|now\s*tv|audible|icloud|google\s*storage|dropbox|patreon|gym|puregym|the\s*gym|fitness|membership/i, 'subscriptions'],
  [/amazon(?!\s*prime)|asos|ebay|next\b|zara|h&m|primark|john\s*lewis|argos|currys|boots|superdrug|ikea|b&q|screwfix|etsy|aliexpress|shein|nike|adidas|sports\s*direct/i, 'shopping'],
  [/british\s*gas|octopus\s*energy|edf|eon|e\.on|ovo|scottish\s*power|bulb|thames\s*water|anglian\s*water|council\s*tax|tv\s*licen|vodafone|\bo2\b|\bee\b|three\b|virgin\s*media|\bbt\b|sky\b|talktalk|plusnet/i, 'bills'],
  [/boots|superdrug|pharmacy|lloyds\s*pharmacy|dentist|dental|optician|specsavers|vision\s*express|nhs|bupa/i, 'health'],
  [/cinema|odeon|vue|cineworld|theatre|ticketmaster|eventbrite|concert|spotify|steam|playstation|xbox|nintendo/i, 'entertainment'],
  [/airbnb|booking\.com|expedia|ryanair|easyjet|british\s*airways|jet2|tui|hotel|premier\s*inn|travelodge|\bflight/i, 'travel'],
  [/\brent\b|mortgage|landlord|letting/i, 'rent'],
  [/pub\b|\bbar\b|wetherspoon|brewdog|wine|beer|majestic\s*wine|bottle\s*shop|off\s*licence/i, 'drinking'],
  [/aviva|axa|admiral|direct\s*line|hastings|churchill|lv=|legal\s*&?\s*general|insurance/i, 'insurance'],
  [/justgiving|gofundme|oxfam|cancer\s*research|british\s*red\s*cross|charity|donation/i, 'charity'],
  [/paypal|klarna|clearpay|laybuy/i, 'shopping'],
]

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
