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

`minScore` and `minComments` set the default threshold for each subscriber-count group. A post is included when it meets either threshold. Use `rulesForSubs` to override both thresholds or exclude posts by their `link_flair_text` for an individual subreddit:

```json
"rulesForSubs": {
  "r/javascript": {
    "minScore": 20,
    "minComments": 5,
    "excludeLinkFlairs": ["Help", "Question"]
  },
  "r/node": {"excludeLinkFlairs": ["Meme"]}
}
```

Subreddit names are case-insensitive and may include the `r/` prefix. To override thresholds, provide both values as non-negative numbers. A flair-only rule uses the default thresholds. `excludeLinkFlairs` contains exact, case-sensitive `link_flair_text` values; posts without flair do not match. Excluded posts are omitted from RSS on the next run, including posts already in storage. For example, `{"minScore": 1, "minComments": 0}` accepts every post with a positive score.

An RSS item title is `subreddit / title`, followed by the comment and score counts. When `link_flair_text` is present, the description starts with a separate paragraph containing `[flair]`.

`maxHoursAgo` delays the first rating check for a post. Every run starts at the top of Reddit's `/new` listing and paginates toward older posts with `after`. `overlapHours` adds a repeated lookback window beyond the previously completed boundary, so posts that gain enough score or comments later can still enter RSS. It defaults to 6 hours when omitted.

The first successful run creates the OPML and a cache of subscriptions. Later, when subscriptions change, the script creates or removes RSS files, rewrites the OPML and sends one notification to `mailTo`. The notification includes direct URLs for newly added RSS feeds as well as the OPML URL. If subscriptions do not change, the OPML is left untouched.

`maxRequests` limits only the number of Reddit pages fetched for new posts; loading the full subscription list does not consume this limit. When that limit is reached, fetched posts and the next Reddit `after` cursor are saved, but the completed time boundary is not advanced. The next manual or scheduled run continues the same fixed time window from that cursor. Once the old boundary is reached, the cursor is cleared and the following run processes posts that arrived during recovery. The script also sends a notification to `mailTo`.
 
## Links

* https://ssl.reddit.com/prefs/apps
* http://www.reddit.com/dev/api

## To-do

* http://embed.ly/docs/embed/api/endpoints/1/oembed
