// Built-in songs: public-domain melodies (plus the original "Scale Sprint" stress test), as RTTTL.
// `tag` is a short genre/origin label shown in the song list.
export const SONGS = [
  { id: 'ode', title: 'Ode to Joy', tag: 'Beethoven', rtttl: 'Ode:d=4,o=5,b=140:e,e,f,g,g,f,e,d,c,c,d,e,e.,8d,2d,e,e,f,g,g,f,e,d,c,c,d,e,d.,8c,2c' },
  { id: 'twinkle', title: 'Twinkle Twinkle', tag: 'Nursery', rtttl: 'Twinkle:d=4,o=5,b=120:c,c,g,g,a,a,2g,f,f,e,e,d,d,2c,g,g,f,f,e,e,2d,g,g,f,f,e,e,2d,c,c,g,g,a,a,2g,f,f,e,e,d,d,2c' },
  { id: 'frere', title: 'Frere Jacques', tag: 'Nursery', rtttl: 'Frere Jacques:d=4,o=5,b=120:c,d,e,c,c,d,e,c,e,f,2g,e,f,2g,8g,8a,8g,8f,e,c,8g,8a,8g,8f,e,c,c,g4,2c,c,g4,2c' },
  { id: 'mary', title: 'Mary Had a Little Lamb', tag: 'Nursery', rtttl: 'Mary:d=4,o=5,b=140:e,d,c,d,e,e,2e,d,d,2d,e,g,2g,e,d,c,d,e,e,e,e,d,d,e,d,1c' },
  { id: 'birthday', title: 'Happy Birthday', tag: 'Traditional', rtttl: 'Birthday:d=4,o=5,b=125:8g.,16g,a,g,c6,2b,8g.,16g,a,g,d6,2c6,8g.,16g,g6,e6,c6,b,2a,8f6.,16f6,e6,c6,d6,2c6' },
  { id: 'jingle', title: 'Jingle Bells', tag: 'Holiday', rtttl: 'Jingle Bells:d=4,o=5,b=160:e,e,2e,e,e,2e,e,g,c.,8d,1e,f,f,f.,8f,f,e,e,8e,8e,e,d,d,e,2d,2g' },
  { id: 'saints', title: 'When the Saints', tag: 'Spiritual', rtttl: 'Saints:d=4,o=5,b=130:8c,8e,8f,2g,8c,8e,8f,2g,8c,8e,8f,g,e,c,e,2d,8e,8e,d,c,c,e,g,g,2a,a,g,e,c,d,2c' },
  { id: 'grace', title: 'Amazing Grace', tag: 'Hymn', rtttl: 'Amazing Grace:d=4,o=5,b=90:8d,g.,8b,g,b,2a,8g,2e,8d,8d,g.,8b,g,b,2a,d6.,8b,d6,b,g,2d,8d,g.,8b,g,b,a.,8g,2e,d6,b,g,a,2g' },
  { id: 'greensleeves', title: 'Greensleeves', tag: 'Folk', rtttl: 'Greensleeves:d=4,o=5,b=100:8a,2c6,8d6,e6.,8f6,e6,2d6,8b,2g,8a,b.,8c6,2a,8a,a.,8g#,8a,2b,8g#,2e,8a,2c6,8d6,e6.,8f6,e6,2d6,8b,2g,8a,b.,8c6,b,8a,g#.,8f#,g#,2a' },
  { id: 'beethoven5', title: 'Symphony No. 5', tag: 'Beethoven', rtttl: 'Beethoven 5:d=4,o=5,b=108:8g,8g,8g,2d#,8p,8f,8f,8f,2d,8p,8g,8g,8g,2d#,8p,8f,8f,8f,2d,8g,8g,8g,2d#' },
  { id: 'entertainer', title: 'The Entertainer', tag: 'Ragtime', rtttl: 'Entertainer:d=8,o=5,b=140:d,d#,e,4c6,e,4c6,e,2c6,c6,d6,d#6,e6,c6,d6,4e6,b,4d6,2c6,d,d#,e,4c6,e,4c6,e,2c6,p,a,g,f#,a,4c6,e6,d6,c6,a,4d6' },
  { id: 'turkish', title: 'Turkish March', tag: 'Mozart', rtttl: 'Turkish March:d=16,o=5,b=140:b,a,g#,a,4c6,d6,c6,b,c6,4e6,f6,e6,d#6,e6,b6,a6,g#6,a6,b6,a6,g#6,a6,4c7,8a6,4c7' },
  { id: 'elise', title: 'Fur Elise', tag: 'Beethoven', rtttl: 'Fur Elise:d=16,o=6,b=130:e,d#,e,d#,e,b5,d,c,8a5,p,c5,e5,a5,8b5,p,e5,g#5,b5,8c6,p,e5,e,d#,e,d#,e,b5,d,c,8a5,p,c5,e5,a5,8b5,p,e5,c6,b5,4a5' },
  { id: 'mountain', title: 'Mountain King', tag: 'Grieg', rtttl: 'Mountain King:d=8,o=5,b=150:e,f#,g,a,b,g,4b,a#,f#,4a#,a,e,4a,e,f#,g,a,b,g,b,e6,d6,b,g,b,4d6' },
  { id: 'sprint', title: 'Scale Sprint', tag: 'Original', rtttl: 'Scale Sprint:d=16,o=5,b=160:c,d,e,f,g,a,b,c6,d6,e6,f6,g6,8e6,8c6,8g,8e,g,a,b,c6,b,a,g,f,e,d,c,d,e,8g,8c6,d6,c6,b,a,g,f,e,d,8c,8e,8g,8c6,4e6,8d6,8b,8g,8d,4c' },
];
