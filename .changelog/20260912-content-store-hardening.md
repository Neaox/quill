Security: Commit identities are sanitised before they are written, so a display name containing angle brackets or a newline can no longer forge commit headers or the trailers a revisions index is rebuilt from.
Fixed: Published objects are written to a temporary file and renamed into place, so a crash mid-write leaves no truncated object behind, and a read verifies that what it returns hashes to the object it asked for.
Fixed: Publishing while somebody else moves or deletes the same document no longer duplicates it under two paths or discards their change silently; a delete against another author's edit is reported as a conflict to resolve.
Fixed: Document history now stops after a bounded number of revisions rather than an unbounded walk, so asking for the history of an old document in a large workspace stays fast.
Fixed: A publish blocked by a stale lock file left behind by a crashed process now says so, naming the file, instead of failing as a lost race after twenty retries.
