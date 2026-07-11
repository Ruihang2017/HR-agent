import { describe, expect, it } from 'vitest'
import { scanText } from '../src/server/ai/sensitive-terms'

describe('scanText - protected attribute detector', () => {
  describe('HITS - should detect sensitive terms', () => {
    it('detects age from "How old are you?"', () => {
      expect(scanText('How old are you?')).toContain('age')
    })

    it('detects age from "What is your date of birth?"', () => {
      expect(scanText('What is your date of birth?')).toContain('age')
    })

    it('detects marital status from "Are you married?"', () => {
      expect(scanText('Are you married?')).toContain('marital status')
    })

    it('detects family plans from "Do you plan to have children?"', () => {
      expect(scanText('Do you plan to have children?')).toContain('family plans')
    })

    it('detects pregnancy from "Are you pregnant?"', () => {
      expect(scanText('Are you pregnant?')).toContain('pregnancy')
    })

    it('detects religion from "What is your religion?"', () => {
      expect(scanText('What is your religion?')).toContain('religion')
    })

    it('detects national origin from "Where were you born?"', () => {
      expect(scanText('Where were you born?')).toContain('national origin')
    })

    it('detects national origin from "What is your nationality?"', () => {
      expect(scanText('What is your nationality?')).toContain('national origin')
    })

    it('detects disability from "Do you have any disabilities?"', () => {
      expect(scanText('Do you have any disabilities?')).toContain('disability')
    })

    it('detects medical from "Any medical conditions we should know about?"', () => {
      expect(scanText('Any medical conditions we should know about?')).toContain('medical')
    })

    it('detects mbti from "What is your MBTI?"', () => {
      expect(scanText('What is your MBTI?')).toContain('mbti')
    })

    it('detects zodiac from "What is your star sign?"', () => {
      expect(scanText('What is your star sign?')).toContain('zodiac')
    })

    it('detects bazi from "你的八字是什么"', () => {
      expect(scanText('你的八字是什么')).toContain('bazi')
    })

    it('detects sexual orientation from "What is your sexual orientation?"', () => {
      expect(scanText('What is your sexual orientation?')).toContain('sexual orientation')
    })

    it('detects age from "Prefers candidates who are young" (memory-proposal phrasing)', () => {
      expect(scanText('Prefers candidates who are young')).toContain('age')
    })

    it('detects gender from "What is your sex?"', () => {
      expect(scanText('What is your sex?')).toContain('gender')
    })

    it('detects national origin from "Where are you from?"', () => {
      expect(scanText('Where are you from?')).toContain('national origin')
    })

    it('detects age from "What year were you born?"', () => {
      expect(scanText('What year were you born?')).toContain('age')
    })

    it('detects marital status from "Are you single?"', () => {
      expect(scanText('Are you single?')).toContain('marital status')
    })

    it('detects sexual orientation from "Are you bisexual?"', () => {
      expect(scanText('Are you bisexual?')).toContain('sexual orientation')
    })

    it('detects sexual orientation from "Do you identify as LGBTQ?"', () => {
      expect(scanText('Do you identify as LGBTQ?')).toContain('sexual orientation')
    })
  })

  describe('CLEAN - should not detect false positives', () => {
    it('allows neutral question about team leadership', () => {
      expect(scanText('Tell me about a time you led a team through a rush period.')).toEqual([])
    })

    it('allows question about language skills (word-boundary check)', () => {
      expect(scanText('What languages do you speak for customer service?')).toEqual([])
    })

    it('allows question about managing conflicts (manage must not match age)', () => {
      expect(scanText('How do you manage roster conflicts?')).toEqual([])
    })

    it('allows question about technical experience', () => {
      expect(scanText('Describe your experience with POS systems.')).toEqual([])
    })

    it('allows "single shift" phrasing (only "are you single" must hit marital status)', () => {
      expect(scanText('Is this a single shift or split shift role?')).toEqual([])
    })

    it('allows "straight answer" phrasing (we deliberately do not match "straight" - too ambiguous)', () => {
      expect(scanText('Give me a straight answer about your availability.')).toEqual([])
    })
  })

  describe('Multiple matches', () => {
    it('returns multiple labels when text matches multiple rules', () => {
      const result = scanText('Are you married and religious?')
      expect(result).toContain('marital status')
      expect(result).toContain('religion')
      expect(result.length).toBe(2)
    })
  })
})
