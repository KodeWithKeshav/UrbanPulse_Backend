jest.mock('axios');
const axios = require('axios');
const jevService = require('../TypeSafeJevService');
const { analyzeTextAuthenticity, refineAuthenticityWithJev } = require('../TextAuthenticityService');

function jevResponse({ category = 'pothole', probabilities, confidence = 0.8, genuine = 0.95 } = {}) {
  return {
    data: {
      model: 'jev-latest',
      answers: {
        urgency: { type: 'score', score: 3, confidence: 0.9 },
        anger: { type: 'score', score: 1.5, confidence: 0.8 },
        frustration: { type: 'score', score: 0, confidence: 0.8 },
        concern: { type: 'score', score: 2.4, confidence: 0.7 },
        category: {
          type: 'choice',
          choice: category,
          probabilities: probabilities || { pothole: 0.9, road_waterlogging: 0.1 },
          confidence,
        },
        is_genuine: { type: 'noul', noul: genuine },
      },
    },
  };
}

describe('TypeSafeJevService', () => {
  const originalKey = process.env.TYPESAFE_API_KEY;

  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    jevService._clearCache();
    axios.post.mockReset();
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  });

  test('returns null without an API key and makes no request', async () => {
    delete process.env.TYPESAFE_API_KEY;
    await expect(jevService.analyzeComplaint({ text: 'Big pothole on MG Road' })).resolves.toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('normalizes scores to 0..1 and sends typed questions', async () => {
    axios.post.mockResolvedValue(jevResponse());
    const result = await jevService.analyzeComplaint({ text: 'Big pothole on MG Road, bikes are falling' });

    expect(result.emotions.urgency).toBe(1);
    expect(result.emotions.anger).toBeCloseTo(0.5);
    expect(result.emotions.frustration).toBe(0);
    expect(result.emotions.concern).toBeCloseTo(0.8);
    expect(result.category).toBe('pothole');
    expect(result.genuineProbability).toBe(0.95);

    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(body.model).toBe('jev-latest');
    expect(body.questions.category.type).toBe('choice');
    expect(body.questions.is_genuine.type).toBe('noul');
    expect(config.headers.Authorization).toBe('Bearer test-key');
  });

  test('dedupes concurrent requests for the same text', async () => {
    axios.post.mockResolvedValue(jevResponse());
    await Promise.all([
      jevService.analyzeComplaint({ text: 'same text here' }),
      jevService.analyzeComplaint({ text: 'same text here' }),
    ]);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('resolves to null on timeout or malformed response', async () => {
    axios.post.mockRejectedValueOnce(Object.assign(new Error('timeout of 2500ms exceeded'), { code: 'ECONNABORTED' }));
    await expect(jevService.analyzeComplaint({ text: 'first' })).resolves.toBeNull();

    axios.post.mockResolvedValueOnce({ data: { answers: {} } });
    await expect(jevService.analyzeComplaint({ text: 'second' })).resolves.toBeNull();
  });
});

describe('refineAuthenticityWithJev', () => {
  const parse = (res) => ({ ...jevService._parseAnswers(res.data.answers) });

  test('returns the heuristic result unchanged when Jev is unavailable', () => {
    const heuristic = analyzeTextAuthenticity({ text: 'Huge pothole near the school gate', category: 'pothole' });
    expect(refineAuthenticityWithJev(heuristic, null, { category: 'pothole' })).toBe(heuristic);
  });

  test('accepts a paraphrased report the keyword matcher misses', () => {
    const text = 'My scooter nearly flipped over on 5th street, the tarmac has caved in badly';
    const heuristic = analyzeTextAuthenticity({ text, category: 'pothole' });
    const refined = refineAuthenticityWithJev(heuristic, parse(jevResponse()), { category: 'pothole' });

    expect(refined.flagged).toBe(false);
    expect(refined.authenticityScore).toBeGreaterThan(heuristic.authenticityScore);
    expect(refined.analysisMethod).toBe('typesafe-jev');
  });

  test('flags a description about a different category and suggests it', () => {
    const text = 'Three cows have been sitting in the middle of the junction all morning';
    const heuristic = analyzeTextAuthenticity({ text, category: 'pothole' });
    const jev = parse(jevResponse({
      category: 'stray_cattle',
      probabilities: { stray_cattle: 0.94, pothole: 0.02 },
      confidence: 0.9,
    }));
    const refined = refineAuthenticityWithJev(heuristic, jev, { category: 'pothole' });

    expect(refined.flagged).toBe(true);
    expect(refined.suggestedCategory).toBe('stray_cattle');
  });

  test('keeps the photo-vs-category cap', () => {
    const text = 'Huge pothole near the school gate';
    const heuristic = analyzeTextAuthenticity({ text, category: 'pothole', imagePrimaryClass: 'fallen_tree' });
    const refined = refineAuthenticityWithJev(heuristic, parse(jevResponse()), {
      category: 'pothole',
      imagePrimaryClass: 'fallen_tree',
    });

    expect(refined.components.categoryMatchScore).toBeLessThanOrEqual(0.3);
    expect(refined.suggestedCategory).toBe('fallen_tree');
  });
});
