// Сквозной пример из docs/05 §2 — он же корпус тестов типов и рантайма.
//
// Файл существует ради ОДНОЙ проверки, которую нельзя сделать иначе: взаимная
// рекурсия `User.posts: links('post')` ↔ `Post.author: link('user')` обязана
// собираться БЕЗ единой аннотации типа и без второго описания схемы. Именно на
// ней рассыпались два из трёх исходных вариантов API — каскадом TS7022/TS7024.

import { atom, dict, index, link, links, list, model, part, parts, t, text } from '../index'

export const User = model('user', {
  name: atom(t.string),
  email: atom(t.pattern(/.+@.+/, 'email').or('')),
  avatar: atom(t.maybe(t.bytes)),
  /** Био по языкам — словарь скаляров, а не отдельная модель. */
  bio: dict(t.string, t.string),
  posts: links('post'),
})

export const Stats = model('stats', {
  views: atom(t.int),
  likes: atom(t.int),
})

export const Comment = model('comment', {
  body: text(),
  author: link('user'),
})

export const Post = model('post', {
  title: atom(t.string),
  status: atom(t.enum(['draft', 'live', 'archived']).or('draft')),
  body: text(),
  tags: list(t.string),
  /** Автор живёт своей жизнью: собственный ленд, собственные права. */
  author: link('user'),
  /** Счётчики живут внутри поста и умирают вместе с ним. */
  stats: part('stats'),
  comments: parts(t.string, 'comment'),
  reactions: dict(t.string, t.int),
}, {
  excerpt: post => post.title().slice(0, 140),
  hot: post => post.stats().likes() > 100,
})

export const Blog = model('blog', {
  posts: links('post'),
  /** Трёхуровневый индекс год → месяц → тег. Бывший empire. */
  archive: index(3, 'post', 'area'),
})

/**
 * Модель на одних атомах — то, что этот слой умеет целиком.
 *
 * Отдельно от `Post` намеренно: `Post` проверяет ТИПЫ всех девяти видов поля,
 * а рантайм-тесты обязаны работать на том, что собрано, а не притворяться.
 */
export const Note = model('note', {
  title: atom(t.string),
  views: atom(t.int),
  status: atom(t.enum(['draft', 'live']).or('draft')),
  tag: atom(t.maybe(t.string)),
}, {
  loud: note => note.title().toUpperCase(),
})

/** Все линзы `t.*` в одной модели: round-trip и отказы проверяются на ней. */
export const Strict = model('strict', {
  count: atom(t.int),
  mail: atom(t.pattern(/.+@.+/, 'email').or('')),
  when: atom(t.maybe(t.date)),
  bin: atom(t.bytes),
  big: atom(t.bigint),
  flag: atom(t.bool),
  ratio: atom(t.number),
  score: atom(t.range(0, 10).or(0)),
  words: atom(t.array(t.string)),
  meters: atom(t.record(t.number)),
  home: atom(t.maybe(t.link)),
})

declare module '../registry' {
  interface Models {
    user: typeof User
    post: typeof Post
    stats: typeof Stats
    comment: typeof Comment
    blog: typeof Blog
    note: typeof Note
    strict: typeof Strict
  }
}
