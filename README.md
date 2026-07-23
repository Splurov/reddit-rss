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

The first successful run creates the OPML and a cache of subscriptions. Later, when subscriptions change, the script creates or removes RSS files, rewrites the OPML and sends one notification to `mailTo`. The notification includes direct URLs for newly added RSS feeds as well as the OPML URL. If subscriptions do not change, the OPML is left untouched. `maxRequests` limits only the number of Reddit pages fetched for new posts; loading the full subscription list does not consume this limit. When that limit is reached, the script saves its partial progress, sends a notification to `mailTo`, and continues from the saved cursor on the next manual or scheduled run.
 
## Links

* https://ssl.reddit.com/prefs/apps
* http://www.reddit.com/dev/api

## To-do

* http://embed.ly/docs/embed/api/endpoints/1/oembed
