// Following is for busbud-lint who want me to remove space between async ()
/* eslint-disable space-before-function-paren */

const expect = require('chai').expect;
const app = require('../app');
const request = require('supertest')(app);
const session = require('supertest-session');

describe('GET /suggestions', () => {
  after(async () => new Promise(resolve => app.close(resolve)));

  describe('with a non-existent city', () => {
    let response;

    before(async () => {
      response = await request.get(
        '/suggestions?q=SomeRandomCityInTheMiddleOfNowhere'
      );
    });

    it('returns a 404', () => {
      expect(response.statusCode).to.equal(404);
    });

    it('returns an empty array of suggestions', () => {
      expect(response.body.suggestions).to.be.instanceof(Array);
      expect(response.body.suggestions).to.have.length(0);
    });
  });

  describe('with a valid city', () => {
    let response;

    before(async () => {
      response = await request.get('/suggestions?q=Montreal');
    });

    it('returns a 200', () => {
      expect(response.statusCode).to.equal(200);
    });

    it('returns an array of suggestions', () => {
      expect(response.body.suggestions).to.be.instanceof(Array);
      expect(response.body.suggestions).to.have.length.above(0);
    });

    it('contains a match', () => {
      expect(response.body.suggestions).to.satisfy(suggestions => {
        return suggestions.some(suggestion =>
          /montréal/i.test(suggestion.name)
        );
      });
    });

    it('contains latitudes and longitudes', () => {
      expect(response.body.suggestions).to.satisfy(suggestions => {
        return suggestions.every(
          suggestion => suggestion.latitude && suggestion.longitude
        );
      });
    });

    it('contains scores', () => {
      expect(response.body.suggestions).to.satisfy(suggestions =>
        suggestions.every(
          suggestion => suggestion.score >= 0 && suggestion.score <= 1
        )
      );
    });
  });

  describe('geo biasing', () => {
    // prevent rate limiting
    afterEach(done => setTimeout(done, 500));

    it('return Washington from Utah while calling from San Francisco', async () => {
      // San Francisco coordinates
      const { body } = await request.get(
        '/suggestions?q=Washing&latitude=37.7577627&longitude=-122.4727052'
      );
      expect(body.suggestions[0].name).to.contains('Utah, US');
    });

    it('return Washington from D.C. while calling from New York', async () => {
      // San Francisco coordinates
      const { body } = await request.get(
        '/suggestions?q=Washing&latitude=40.6976633&longitude=-74.1201063'
      );
      expect(body.suggestions[0].name).to.contains('New Jersey, US');
    });
  });

  describe('allow localized names', () => {
    // prevent rate limiting
    afterEach(done => setTimeout(done, 500));

    // IT SEEMS LIKE A BUG IN SUPERAGENT - it doesn't encode query string

    it('return Washington for Вашинг', async () => {
      // San Francisco coordinates
      const { body } = await request
        .get('/suggestions')
        .query(`q=${encodeURIComponent('Вашинг')}`);
      expect(body.suggestions[0].name).to.contains('Washington');
    });

    it('return Montreal for Monreāl', async () => {
      // San Francisco coordinates
      const { body } = await request
        .get('/suggestions')
        .query(`q=${encodeURIComponent('monreāl')}`);
      expect(body.suggestions[0].name).to.contains('Montréal');
    });
  });

  describe('allow some misspellings and case insensitive names', () => {
    // prevent rate limiting
    afterEach(done => setTimeout(done, 500));

    // IT SEEMS LIKE A BUG IN SUPERAGENT - it doesn't encode query string

    it('return Montréal for Nonreal', async () => {
      // San Francisco coordinates
      const { body } = await request.get('/suggestions').query(`q=Nonreal`);
      expect(body.suggestions[0].name).to.contains('Montréal');
    });

    it('return Montreal for MONtREaL', async () => {
      // San Francisco coordinates
      const { body } = await request.get('/suggestions').query(`q=MONtREaL`);
      expect(body.suggestions[0].name).to.contains('Montréal');
    });
  });

  describe('uses session information', () => {
    let testSession;
    beforeEach(() => {
      testSession = session(app);
    });

    // prevent rate limiting
    afterEach(done => setTimeout(done, 500));

    it('should return 304 and the same result for the same query in session', async () => {
      await testSession.get('/suggestions').query(`q=montr`);
      await testSession
        .get('/suggestions')
        .query(`q=montr`)
        .expect(304);
    });

    it('should use session results for incremental typing and score should grow', async () => {
      const t1 = process.hrtime.bigint();
      await testSession
        .get('/suggestions?q=mont&latitude=40.6976633&longitude=-74.1201063')
        .expect(200);
      const d1 = Number(process.hrtime.bigint() - t1);

      const t2 = process.hrtime.bigint();
      const req2 = await testSession
        .get('/suggestions?q=montr&latitude=40.6976633&longitude=-74.1201063')
        .expect(200);
      const d2 = Number(process.hrtime.bigint() - t2);
      expect(d2).to.be.below(d1);

      const t3 = process.hrtime.bigint();
      const req3 = await testSession
        .get('/suggestions?q=montre&latitude=40.6976633&longitude=-74.1201063')
        .expect(200);
      const d3 = Number(process.hrtime.bigint() - t3);
      expect(d3).to.be.below(d1);

      // ensure score is incrementing at evert type
      expect(req2.body.suggestions[0].score).to.be.below(
        req3.body.suggestions[0].score
      );
    });
  });

  describe('requests rate limiting', () => {
    // exhaust rate limiting first
    before(done => setTimeout(done, 1100));

    it('should hit rate limiting after 5 requests in 1 sec', async () => {
      // It'd love to do sequential requests and check for X-RateLimit-Remaining
      // but Heroku CI seems to be too slow to make 5 requests in 1 sec
      // So, trying another approach
      // sending 6 different requests, so, 1 must hit rate limiting and others must return X-RateLimit-Remaining from 0 to 5
      const results = await Promise.all(
        [
          '/suggestions?q=mont&latitude=40.6976633&longitude=-74.1201063',
          '/suggestions?q=montr&latitude=40.6976633&longitude=-74.1201063',
          '/suggestions?q=montre&latitude=40.6976633&longitude=-74.1201063',
          '/suggestions?q=montrea&latitude=40.6976633&longitude=-74.1201063',
          '/suggestions?q=montreal&latitude=40.6976633&longitude=-74.1201063',
          '/suggestions?q=montreals&latitude=40.6976633&longitude=-74.1201063'
        ].map(u => request.get(u))
      );

      // set of 0..4
      const rateCounter = new Set(Array.from({ length: 5 }, (k, i) => '' + i));
      for (const { headers, statusCode } of results) {
        // passed request
        if (statusCode === 200) {
          expect(rateCounter.has(headers['x-ratelimit-remaining'])).to.be.true;
          rateCounter.delete(headers['x-ratelimit-remaining']);
        } else {
          // rate limited request
          expect(statusCode).to.equal(429); // too many requests
          expect(headers['retry-after']).to.equal('1');
        }
      }
      // make sure all rate limiters were exhausted
      expect(rateCounter.size).to.equal(0);
    });
  });
});
