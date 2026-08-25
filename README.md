# reddit-rss

reddit-rss generates a separate RSS feed for every subreddit you follow and an OPML subscription containing all feeds.

## Installation

* `npm install`
* `cp config.json.example config.json`
* `cp storage.json.example storage.json`
* edit `config.json` with your preferences, Reddit credentials and public URLs
* run: `node index.js`
* set up crontab for regular updates

## Output

`rssDirectoryPath` contains one XML file per subscribed subreddit, including valid empty feeds for subreddits without posts. `opmlFilePath` contains the OPML subscription.

`rssPublicBaseUrl` must be the public URL for `rssDirectoryPath`, and `opmlPublicUrl` must be the public URL for `opmlFilePath`; RSS clients use these URLs, not local file paths.

## Post filters

`minScore` and `minComments` set the default threshold for each subscriber-count group. A post is included when it meets either threshold. Use `minRulesForSubs` to override both thresholds for an individual subreddit:

```json
"minRulesForSubs": {
  "r/javascript": {"minScore": 20, "minComments": 5}
}
```

Subreddit names are case-insensitive and may include the `r/` prefix. A rule needs both values, which must be non-negative numbers. For example, `{"minScore": 1, "minComments": 0}` preserves the former behavior of accepting every post with a positive score.

`maxHoursAgo` delays the first rating check for a post. Every run starts at the top of Reddit's `/new` listing and paginates toward older posts with `after`. `overlapHours` adds a repeated lookback window beyond the previously completed boundary, so posts that gain enough score or comments later can still enter RSS. It defaults to 6 hours when omitted.

The first successful run creates the OPML and a cache of subscriptions. Later, when subscriptions change, the script creates or removes RSS files, rewrites the OPML and sends one notification to `mailTo`. The notification includes direct URLs for newly added RSS feeds as well as the OPML URL. If subscriptions do not change, the OPML is left untouched.

`maxRequests` limits only the number of Reddit pages fetched for new posts; loading the full subscription list does not consume this limit. When that limit is reached, fetched posts and the next Reddit `after` cursor are saved, but the completed time boundary is not advanced. The next manual or scheduled run continues the same fixed time window from that cursor. Once the old boundary is reached, the cursor is cleared and the following run processes posts that arrived during recovery. The script also sends a notification to `mailTo`.
 
## Links

* https://ssl.reddit.com/prefs/apps
* http://www.reddit.com/dev/api

## To-do

* http://embed.ly/docs/embed/api/endpoints/1/oembed
