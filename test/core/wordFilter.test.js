import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterWords, matchesWord, passesWords } from '../../src/core/wordFilter.js';

test('word filters: plain words anywhere, #hashtags as whole tags, case ignored', () => {
	assert.deepEqual(filterWords([' #BRL ', 'RP', '#brl', '']), ['#brl', 'rp']);
	assert.equal(matchesWord('live #brl ce soir', '#brl'), true);
	assert.equal(matchesWord('#brl', '#brl'), true);
	assert.equal(matchesWord('live (#brl)', '#brl'), true);
	assert.equal(matchesWord('live #brlife', '#brl'), false, 'another tag that starts the same');
	assert.equal(matchesWord('live brl', '#brl'), false, 'the word without # is not the tag');
	assert.equal(matchesWord('mail@#brl', '#brl'), true);
	assert.equal(matchesWord('live #brothers.life', '#brothers.life'), true, 'special characters are literal');
	assert.equal(matchesWord('live #brothersxlife', '#brothers.life'), false);
	assert.equal(matchesWord('soirée #été', '#été'), true);
	assert.equal(matchesWord('soirée #étés', '#été'), false);
	// A plain word still matches inside a tag, as before
	assert.equal(matchesWord('live #brlife', 'brl'), true);

	const config = { requireWords: ['#brotherslife', 'event'], excludeWords: ['#rediff'] };
	assert.equal(passesWords(config, 'Course de la bêta #BrothersLife'), true);
	assert.equal(passesWords(config, 'Gros EVENT ce soir'), true);
	assert.equal(passesWords(config, 'Course #BrothersLifeRP'), false);
	assert.equal(passesWords(config, 'Course #BrothersLife #rediff'), false);
	assert.equal(passesWords({ requireWords: [], excludeWords: [] }, 'tout passe'), true);
});
