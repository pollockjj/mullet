# MULLET data

`chats/` holds one JSONL file per saved transcript. Line 1 is the chat header; every line
after it is one message. They are plain text: open them in any editor, copy them, delete
them, grep them, or put them under version control. MULLET reads whatever is here on the
next listing, and a hand-edited file that has one broken line still loads — the broken line
is reported and skipped rather than losing the conversation.

The location is set by `MULLET_DATA_DIR` in the launchd plist.
