const bookFields = ['class', 'classNum', 'standard', 'subject', 'title', 'bookCodes', 'exams', 'edition', 'version', 'source', 'sourceUrl', 'sourceReferences', 'createdAt', 'updatedAt'];
const chapterFields = ['chapterNumber', 'name', 'slug', 'code', 'filename', 'pdfPath', 'part', 'pages', 'bytes', 'edition', 'version', 'source', 'sourceUrl', 'sourceReferences'];
const topicFields = ['topicNumber', 'name', 'slug', 'code', 'edition', 'version', 'source', 'sourceUrl', 'sourceReferences'];
const pick = (record, keys) => Object.fromEntries(keys.filter(k => record[k] !== undefined).map(k => [k, record[k]]));

export function textbookMetadata(raw) {
  const id = String(raw._id);
  const chapters = (raw.chapters || []).map((chapter, index) => {
    const chapterId = `${id}:${chapter.code || index}`;
    const topics = (chapter.topics || []).map((topic, topicIndex) => ({ ...pick(topic, topicFields), id: `${chapterId}:${topic.topicNumber || topicIndex}`, chapterId, textbookId: id }));
    return { ...pick(chapter, chapterFields), id: chapterId, textbookId: id, topics, totalTopics: topics.length };
  });
  return { ...pick(raw, bookFields), id, chapters, totalChapters: chapters.length, chapterScopedTopicCount: chapters.reduce((n, c) => n + c.topics.length, 0),
    bookLevelTopicCount: (raw.topics || []).length, contentAvailability: 'metadata-only',
    sourceNote: 'PDF paths are source references, not public download URLs. Chapter marks are not official examination weightage.' };
}
export function selectChapter(book, selector) {
  return book.chapters.filter(c => [c.id, c.code, c.slug, String(c.chapterNumber)].includes(selector));
}
export function searchMetadata(books, query) {
  const q = query.toLocaleLowerCase();
  return books.flatMap(book => book.chapters.flatMap(chapter => [
    ...(chapter.name?.toLocaleLowerCase().includes(q) ? [{ kind: 'chapter', textbookId: book.id, chapterId: chapter.id, standard: book.standard, subject: book.subject, ...pick(chapter, chapterFields) }] : []),
    ...chapter.topics.filter(t => t.name?.toLocaleLowerCase().includes(q)).map(topic => ({ kind: 'topic', textbookId: book.id, chapterId: chapter.id, standard: book.standard, subject: book.subject, chapterNumber: chapter.chapterNumber, chapterName: chapter.name, ...topic })),
  ]));
}
