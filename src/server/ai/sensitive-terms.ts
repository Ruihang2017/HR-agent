/**
 * Protected-attribute / unlawful-topic detector shared by question filtering (F5.2)
 * and the memory gate (F7.3). Conservative on purpose: false positives cost a boss
 * a question; false negatives leak discrimination into questions or memory.
 */

interface Rule { label: string; re: RegExp }

const RULES: Rule[] = [
  { label: 'age', re: /\bage\b|\bhow old\b|\bdate of birth\b|\bbirth ?(year|date)\b|\byear were you born\b|\byoung(er)?\b|\bolder\b|\belderly\b/i },
  { label: 'gender', re: /\bgender\b|\bsex\b|\bmale\b|\bfemale\b|\bman\b|\bwoman\b/i },
  { label: 'marital status', re: /\bmarried\b|\bmarital\b|\bspouse\b|\bhusband\b|\bwife\b|\bare you single\b|\bdivorced\b/i },
  { label: 'family plans', re: /\bchildren\b|\bkids\b|\bfamily plan/i },
  { label: 'pregnancy', re: /\bpregnan/i },
  { label: 'religion', re: /\breligio|\bchurch\b|\bfaith\b|\bworship\b/i },
  { label: 'race or ethnicity', re: /\brace\b|\bethnic|\bskin colou?r\b/i },
  { label: 'national origin', re: /\bnationality\b|\bwhere were you born\b|\bwhere are you from\b|\bcountry of (origin|birth)\b|\bcitizenship\b/i },
  { label: 'disability', re: /\bdisabilit|\bdisabled\b|\bimpairment\b/i },
  { label: 'medical', re: /\bmedical\b|\bhealth condition|\billness\b|\bmental health\b|\bdiagnos/i },
  // 'straight' is deliberately NOT matched: too ambiguous in hiring text
  // ("straight answer", "straight shifts") — false positives would swamp the signal.
  { label: 'sexual orientation', re: /\bsexual orientation\b|\bgay\b|\blesbian\b|\bqueer\b|\bbisexual\b|\blgbtq?\b/i },
  { label: 'zodiac', re: /\bzodiac\b|\bstar sign\b|\bhoroscope\b|星座/i },
  { label: 'bazi', re: /\bbazi\b|八字/i },
  { label: 'mbti', re: /\bmbti\b|\bmyers.?briggs\b/i }
]

export function scanText(text: string): string[] {
  return RULES.filter(r => r.re.test(text)).map(r => r.label)
}
