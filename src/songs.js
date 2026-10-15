// Built-in songs: classical and folk melodies, well-known themes and hits, as RTTTL.
// Pop/TV/film themes belong to their respective rights holders; these are short fan transcriptions for a rhythm game.
// RTTTL sources: PICAXE archive (https://picaxe.com/rtttl-ringtones-for-tune-command/) and FlipperMusicRTTTL
// (https://github.com/neverfa11ing/FlipperMusicRTTTL); classical/folk tunes hand-written. See README "Song sources & credits".
// `category` groups songs in the song-select tabs (see CATEGORIES); `tag` is a short composer/game/artist label.
export const CATEGORIES = [
  { id: 'classical', label: 'Classical' },
  { id: 'pop', label: 'Pop & Rock' },
  { id: 'dance', label: 'Eurodance' },
  { id: 'ndw', label: 'NDW & Synth' },
  { id: 'screen', label: 'TV & Film' },
  { id: 'videogame', label: 'Video Games' },
  { id: 'folk', label: 'Folk & Kids' },
];
export const SONGS = [
  { id: 'ode', category: 'classical', title: 'Ode to Joy', tag: 'Beethoven', rtttl: 'Ode:d=4,o=5,b=140:e,e,f,g,g,f,e,d,c,c,d,e,e.,8d,2d,e,e,f,g,g,f,e,d,c,c,d,e,d.,8c,2c' },
  { id: 'twinkle', category: 'folk', title: 'Twinkle Twinkle', tag: 'Nursery', rtttl: 'Twinkle:d=4,o=5,b=120:c,c,g,g,a,a,2g,f,f,e,e,d,d,2c,g,g,f,f,e,e,2d,g,g,f,f,e,e,2d,c,c,g,g,a,a,2g,f,f,e,e,d,d,2c' },
  { id: 'frere', category: 'folk', title: 'Frere Jacques', tag: 'Nursery', rtttl: 'Frere Jacques:d=4,o=5,b=120:c,d,e,c,c,d,e,c,e,f,2g,e,f,2g,8g,8a,8g,8f,e,c,8g,8a,8g,8f,e,c,c,g4,2c,c,g4,2c' },
  { id: 'mary', category: 'folk', title: 'Mary Had a Little Lamb', tag: 'Nursery', rtttl: 'Mary:d=4,o=5,b=140:e,d,c,d,e,e,2e,d,d,2d,e,g,2g,e,d,c,d,e,e,e,e,d,d,e,d,1c' },
  { id: 'birthday', category: 'folk', title: 'Happy Birthday', tag: 'Traditional', rtttl: 'Birthday:d=4,o=5,b=125:8g.,16g,a,g,c6,2b,8g.,16g,a,g,d6,2c6,8g.,16g,g6,e6,c6,b,2a,8f6.,16f6,e6,c6,d6,2c6' },
  { id: 'jingle', category: 'folk', title: 'Jingle Bells', tag: 'Holiday', rtttl: 'Jingle Bells:d=4,o=5,b=160:e,e,2e,e,e,2e,e,g,c.,8d,1e,f,f,f.,8f,f,e,e,8e,8e,e,d,d,e,2d,2g' },
  { id: 'saints', category: 'folk', title: 'When the Saints', tag: 'Spiritual', rtttl: 'Saints:d=4,o=5,b=130:8c,8e,8f,2g,8c,8e,8f,2g,8c,8e,8f,g,e,c,e,2d,8e,8e,d,c,c,e,g,g,2a,a,g,e,c,d,2c' },
  { id: 'grace', category: 'folk', title: 'Amazing Grace', tag: 'Hymn', rtttl: 'Amazing Grace:d=4,o=5,b=90:8d,g.,8b,g,b,2a,8g,2e,8d,8d,g.,8b,g,b,2a,d6.,8b,d6,b,g,2d,8d,g.,8b,g,b,a.,8g,2e,d6,b,g,a,2g' },
  { id: 'greensleeves', category: 'folk', title: 'Greensleeves', tag: 'Folk', rtttl: 'Greensleeves:d=4,o=5,b=100:8a,2c6,8d6,e6.,8f6,e6,2d6,8b,2g,8a,b.,8c6,2a,8a,a.,8g#,8a,2b,8g#,2e,8a,2c6,8d6,e6.,8f6,e6,2d6,8b,2g,8a,b.,8c6,b,8a,g#.,8f#,g#,2a' },
  { id: 'beethoven5', category: 'classical', title: 'Symphony No. 5', tag: 'Beethoven', rtttl: 'Beethoven 5:d=4,o=5,b=108:8g,8g,8g,2d#,8p,8f,8f,8f,2d,8p,8g,8g,8g,2d#,8p,8f,8f,8f,2d,8g,8g,8g,2d#' },
  { id: 'entertainer', category: 'folk', title: 'The Entertainer', tag: 'Ragtime', rtttl: 'Entertainer:d=8,o=5,b=140:d,d#,e,4c6,e,4c6,e,2c6,c6,d6,d#6,e6,c6,d6,4e6,b,4d6,2c6,d,d#,e,4c6,e,4c6,e,2c6,p,a,g,f#,a,4c6,e6,d6,c6,a,4d6' },
  { id: 'turkish', category: 'classical', title: 'Turkish March', tag: 'Mozart', rtttl: 'Turkish March:d=16,o=5,b=140:b,a,g#,a,4c6,d6,c6,b,c6,4e6,f6,e6,d#6,e6,b6,a6,g#6,a6,b6,a6,g#6,a6,4c7,8a6,4c7' },
  { id: 'elise', category: 'classical', title: 'Fur Elise', tag: 'Beethoven', rtttl: 'Fur Elise:d=16,o=6,b=130:e,d#,e,d#,e,b5,d,c,8a5,p,c5,e5,a5,8b5,p,e5,g#5,b5,8c6,p,e5,e,d#,e,d#,e,b5,d,c,8a5,p,c5,e5,a5,8b5,p,e5,c6,b5,4a5' },
  { id: 'mountain', category: 'classical', title: 'Mountain King', tag: 'Grieg', rtttl: 'Mountain King:d=8,o=5,b=150:e,f#,g,a,b,g,4b,a#,f#,4a#,a,e,4a,e,f#,g,a,b,g,b,e6,d6,b,g,b,4d6' },
  { id: 'cancan', category: 'classical', title: 'Can-Can', tag: 'Offenbach', rtttl: 'Can-Can:d=8,o=5,b=150:4c6,4g,4g,4a,4g,4p,4c6,4g,4g,4a,4g,4p,4c6,4g,4a,4b,2c6,4g,4g,4f,4e,2c' },
  { id: 'smoke', category: 'pop', title: 'Smoke on the Water', tag: 'Deep Purple', rtttl: 'Smoke:d=4,o=4,b=112:8e,8g,4a,8e,8g,4a#,4a,8e,8g,4a,4g,2e' },
  { id: 'seven', category: 'pop', title: 'Seven Nation Army', tag: 'The White Stripes', rtttl: 'Seven Nation:d=8,o=5,b=124:4e.,e,4g,e,4d,c,2b4,p,4e.,e,4g,e,4d,c,2b4' },
  { id: 'takeonme', category: 'pop', title: 'Take On Me', tag: 'a-ha', rtttl: 'Take On Me:d=16,o=5,b=90:8f#,8f#,8d,8b4,8p,8b4,8p,8e,8p,8e,8p,8e,8g#,8g#,a,b,a,b,e,8d,8f#,8f#,8f#,8e,8e,f#,e' },
  { id: 'axelf', category: 'screen', title: 'Axel F', tag: 'Harold Faltermeyer', rtttl: 'Axel F:d=8,o=5,b=125:4f,a.,f,16f,4a#,f,d#,f,4c6,f,f,4d6,c6,a,f,c6,f6,16f,d#,16d#,c,g,4f' },
  { id: 'panther', category: 'screen', title: 'Pink Panther', tag: 'Henry Mancini', rtttl: 'Pink Panther:d=4,o=5,b=160:8d#,8e,2p,8f#,8g,2p,8d#,8e,16p,8f#,8g,16p,8c6,8b,16p,8d#,8e,16p,8b,2a#,2p,16a,16g,16e,16d,2e' },
  { id: 'imperial', category: 'screen', title: 'Imperial March', tag: 'John Williams', rtttl: 'Imperial March:d=4,o=5,b=104:g,g,g,8d#.,16a#4,g,8d#.,16a#4,2g,d6,d6,d6,8d#6.,16a#4,f#,8d#.,16a#4,2g' },
  { id: 'tetris', category: 'videogame', title: 'Tetris Theme', tag: 'Tetris', rtttl: 'Tetris:d=4,o=5,b=160:e6,8b,8c6,8d6,16e6,16d6,8c6,8b,a,8a,8c6,e6,8d6,8c6,b,8b,8c6,d6,e6,c6,a,2a,8p,d6,8f6,a6,8g6,8f6,e6,8c6,e6,8d6,8c6,b,8b,8c6,d6,e6,c6,a,a' },
  { id: 'mario', category: 'videogame', title: 'Super Mario Overworld', tag: 'Super Mario Bros.', rtttl: 'Mario:d=4,o=5,b=100:16e6,16e6,32p,8e6,16c6,8e6,8g6,8p,8g,8p,8c6,16p,8g,16p,8e,16p,8a,8b,16a#,8a,16g.,16e6,16g6,8a6,16f6,8g6,8e6,16c6,16d6,8b' },
  { id: 'zelda', category: 'videogame', title: 'Zelda Main Theme', tag: 'The Legend of Zelda', rtttl: 'Zelda:d=4,o=5,b=125:a#,f.,8a#,16a#,16c6,16d6,16d#6,2f6,8p,8f6,16f6,16f#6,16g#6,2a#6,16a#6,16g#6,16f#6,8g#6,16f#6,2f6,f6,8d#6,16d#6,16f6,2f#6,8f6,8d#6,8c#6,16c#6,16d#6,2f6' },
  { id: 'pacman', category: 'videogame', title: 'Pac-Man Intro', tag: 'Pac-Man', rtttl: 'PacMan:d=16,o=5,b=140:b,b6,f#6,d#6,8b6,4f#6,c6,c7,g6,e6,8c7,4g6,b,b6,f#6,d#6,8b6,8f#6,8d#6,8d#6,e6,f6,8f6,8f#6,g6,8g6,8g#6,a6,8b6' },
  { id: 'storms', category: 'videogame', title: 'Song of Storms', tag: 'Ocarina of Time', rtttl: 'Song of Storms:d=8,o=5,b=140:d,f,2d6,d,f,2d6,e6,4f6,8e6,f6,e6,c6,4a,4a,d,f,g,a,4a,d,f,g,e,2d' },
  { id: 'megalovania', category: 'videogame', title: 'Megalovania', tag: 'Undertale', rtttl: 'Megalovania:d=16,o=5,b=120:d,d,8d6,8a,4p,g#,8p,8g,8f,d,f,g,c,c,8d6,8a,4p,g#,8p,8g,8f,d,f,g,b4,b4,8d6,8a,4p,g#,8p,8g,8f,d,f,g,a#4,a#4,8d6,8a,4p,g#,8p,8g,8f,d,f,g' },
  { id: 'doom', category: 'videogame', title: 'At Doom\'s Gate', tag: 'Doom', rtttl: 'doom:d=4,o=5,b=112:16e4,16e4,16e,16e4,16e4,16d,16e4,16e4,16c,16e4,16e4,16a#4,16e4,16e4,16b4,16c,16e4,16e4,16e,16e4,16e4,16d,16e4,16e4,16c,16e4,16e4,a#4,16p,16e4,16e4,16e,16e4,16e4,16d,16e4,16e4,16c,16e4,16e4,16a#4,16e4,16e4,16b4,16c,16e4,16e4,16e,16e4,16e4,16d,16e4,16e4,16c,16e4,16e4,a#4,16p,16a4,16a4,16a,16a4,16a4,16g,16a4,16a4,16f,16a4,16a4,16d#,16a4,16a4,16e,16f,16a4,16a4,16a,16a4,16a4,16g,16a4,16a4,16f,16a4,16a4,d#' },
  { id: 'smbunder', category: 'videogame', title: 'Super Mario Underground', tag: 'Super Mario Bros.', rtttl: 'smb_under:d=4,o=6,b=100:32c,32p,32c7,32p,32a5,32p,32a,32p,32a#5,32p,32a#,2p,32c,32p,32c7,32p,32a5,32p,32a,32p,32a#5,32p,32a#,2p,32f5,32p,32f,32p,32d5,32p,32d,32p,32d#5,32p,32d#,2p,32f5,32p,32f,32p,32d5,32p,32d,32p,32d#5,32p,32d#' },
  { id: 'marble', category: 'videogame', title: 'Marble Zone', tag: 'Sonic the Hedgehog', rtttl: 'Marblezo:d=4,o=6,b=125:8a5,8b5,8c5,8d5,8b5,8p,8b5,8a5,8b5,8p,8b5,8a5,8b5,8a5,8a5,8c5,g5,8a5,1f.5,8a5,8p,8a5,8g5,8a5,8p,8a5,8g5,a5,b5,f.5,1e5,8a5,8b5,8c5,8d5,8b5,8p,8b5,8a5,8b5,8p,8b5' },
  { id: 'ducktales', category: 'videogame', title: 'DuckTales Moon', tag: 'DuckTales', rtttl: 'ducktales:d=4,o=5,b=112:8e6,8e6,16p,16g6,8b6,g#6,p,8e6,8d6,8c6,8d6,8e6,8d6,8c6,8d6,8e6,8e6,16p,16g6,8b6,g#6,p,8e6,8d6,8c6,8d6,8e6,8d6,8c6,8g6,8e6,8e6' },
  { id: 'vampirekiller', category: 'videogame', title: 'Vampire Killer', tag: 'Castlevania', rtttl: 'cv_vk:d=4,o=5,b=100:8d5,32P,8a5,32P,32g#5,32P,32a5,32P,32g#5,32P,8f5,8P,32f6,32P,32d6,8P,32f5,32P,32d5,32P,32f6,8P,32f6,8P,32f6,8P,8d5,32P,8a5,32P,32g#5,32P,32a5,32P,32g#5,32P,32f5,4P,32f6,32P,32d6,8P,32f5,32P,32d5,32P,32f7,32P,32c7,32P,32g#6,32P,32f6,32P,32f5,32P,32d6,32P,32f6,32P,32g#6,32P,8c#5,32P,8e5,32P,16a#5,32P,8a5,32P,8f5,32P,16d5,32P,8c#5,32P,8e5,32P,16a#5,32P,16a5,32P,32d5,4P,8c#5,32P,8e5,32P,16a#5,32P,8a5,32P,8f5,32P,16d5,32P,8e5,32P,8g5,32P,16a#5,32P,8a5,32P,8b5,32P,16c#6,32P,32d6,32P,32d6,32P,32d5,32P,4d5' },
  { id: 'smw', category: 'videogame', title: 'Super Mario World', tag: 'Super Mario World', rtttl: 'smwwd1:d=4,o=5,b=125:a,8f.,16c,16d,16f,16p,f,16d,16c,16p,16f,16p,16f,16p,8c6,8a.,g,16c,a,8f.,16c,16d,16f,16p,f,16d,16c,16p,16f,16p,16a#,16a,16g,2f,16p,8a.,8f.,8c,8a.,f,16g#,16f,16c,16p,8g#.,2g,8a.,8f.,8c,8a.,f,16g#,16f,8c,2c6' },
  { id: 'bubble', category: 'videogame', title: 'Bubble Bobble', tag: 'Bubble Bobble', rtttl: 'Bubble Bobble:d=4,o=5,b=125:8a#6,8a6,8g.6,16f6,8a6,8g6,8f6,8d#6,8g6,8f6,16d#6,8d.6,f.6,16d6,16c6,8a#,8c6,8d6,8d#6,8c6,16d6,8d#.6,8f6,8f6,8g6,16a6,8g.6,8f6,8f6,8g6,8a6,8a#6,8a6,8g.6,16f6,8a6,8g6,8f6,8d#6,8g6,8f6,16d#6,8d.6,f.6,16d6,16c6,8a#,8c6,8d6,8d#6,8c6,16d6,8d#.6,8f6,8f6,8g6,16a6,8f.6,8a#.6' },
  { id: 'guile', category: 'videogame', title: 'Guile Stage', tag: 'Street Fighter II', rtttl: 'Guile:d=4,o=5,b=125:8c#6,16c#6,8b,16b,2c#6,16c#6,8b,8c#6,16c#6,8b,16b,2c#6,16c#6,8b,16c#6,8b,8c#6,8b,8f#6,16f#6,8e6,8d#6,8b' },
  { id: 'canon', category: 'classical', title: 'Canon in D', tag: 'Pachelbel', rtttl: 'Canon:d=4,o=5,b=100:2f#,2e,2d,2c#,2b4,2a4,2b4,2c#,8d,8f#,8a,8a,8g,8b,8a,8f#,8d,8d,8f#,8a,8a,8b,8c#6,8a,2f#,2e,2d' },
  { id: 'moonlight', category: 'classical', title: 'Moonlight Sonata', tag: 'Beethoven', rtttl: 'Moonlight:d=8,o=4,b=66:g#,c#5,e5,g#,c#5,e5,g#,c#5,e5,g#,c#5,e5,a,c#5,e5,a,c#5,e5,f#,a,c#5,f#,a,c#5,g#,b,d#5,g#,b,d#5' },
  { id: 'nachtmusik', category: 'classical', title: 'Eine kleine Nachtmusik', tag: 'Mozart', rtttl: 'Nachtmusik:d=8,o=5,b=140:g,4p,d,4p,g,4p,d,4p,g,d,g,b,4d6,4p,c6,4p,a,c6,a,f#,4d,4p' },
  { id: 'tell', category: 'classical', title: 'William Tell Overture', tag: 'Rossini', rtttl: 'William Tell:d=16,o=5,b=140:8b,b,b,8b,b,b,8b,b,b,8e6,e6,e6,8e6,e6,e6,8e6,e6,e6,8g6,g6,g6,8e6,e6,e6,4c6,8b,8a,4g' },
  { id: 'nokia', category: 'pop', title: 'Nokia Tune', tag: 'Nokia (Gran Vals)', rtttl: 'Nokia Tune:d=4,o=5,b=225:8e6,8d6,f#,g#,8c#6,8b,d,e,8b,8a,c#,e,2a,4p,8e6,8d6,f#,g#,8c#6,8b,d,e,8b,8a,c#,e,2a,4p,8e6,8d6,f#,g#,8c#6,8b,d,e,8b,8a,c#,e,2a,4p,8e6,8d6,f#,g#,8c#6,8b,d,e,8b,8a,c#,e,2a' },
  { id: 'popcorn', category: 'dance', title: 'Popcorn', tag: 'Gershon Kingsley', rtttl: 'Popcorn:d=16,o=5,b=160:a,p,g,p,a,p,e,p,c,p,e,p,8a4,8p,a,p,g,p,a,p,e,p,c,p,e,p,8a4,8p,a,p,b,p,c6,p,b,p,c6,p,a,p,b,p,a,p,b,p,g,p,a,p,g,p,a,p,f,8a,8p' },
  { id: 'mission', category: 'screen', title: 'Mission: Impossible', tag: 'Lalo Schifrin', rtttl: 'Mission Impossible:d=16,o=6,b=95:32d,32d#,32d,32d#,32d,32d#,32d,32d#,32d,32d,32d#,32e,32f,32f#,32g,g,8p,g,8p,a#,p,c7,p,g,8p,g,8p,f,p,f#,p,g,8p,g,8p,a#,p,c7,p,g,8p,g,8p,f,p,f#,p,a#,g,2d,32p,a#,g,2c#,32p,a#,g,2c,a#5,8c,2p,32p,a#5,g5,2f#,32p,a#5,g5,2f,32p,a#5,g5,2e,d#,8d' },
  { id: 'bond', category: 'screen', title: 'James Bond Theme', tag: 'Monty Norman', rtttl: 'Bond:d=4,o=5,b=80:32p,16c#6,32d#6,32d#6,16d#6,8d#6,16c#6,16c#6,16c#6,16c#6,32e6,32e6,16e6,8e6,16d#6,16d#6,16d#6,16c#6,32d#6,32d#6,16d#6,8d#6,16c#6,16c#6,16c#6,16c#6,32e6,32e6,16e6,8e6,16d#6,16d6,16c#6,16c#7,c.7,16g#6,16f#6,g#.6' },
  { id: 'starwars', category: 'screen', title: 'Star Wars Theme', tag: 'John Williams', rtttl: 'Star Wars:d=4,o=5,b=45:32p,32f#,32f#,32f#,8b.,8f#.6,32e6,32d#6,32c#6,8b.6,16f#.6,32e6,32d#6,32c#6,8b.6,16f#.6,32e6,32d#6,32e6,8c#6' },
  { id: 'indiana', category: 'screen', title: 'Raiders March', tag: 'John Williams', rtttl: 'Indiana:d=4,o=5,b=250:e,8p,8f,8g,8p,1c6,8p.,d,8p,8e,1f,p.,g,8p,8a,8b,8p,1f6,p,a,8p,8b,2c6,2d6,2e6,e,8p,8f,8g,8p,1c6,p,d6,8p,8e6,1f.6,g,8p,8g,e.6,8p,d6,8p,8g,e.6,8p,d6,8p,8g,f.6,8p,e6,8p,8d6,2c6' },
  { id: 'simpsons', category: 'screen', title: 'The Simpsons', tag: 'Danny Elfman', rtttl: 'Simpsons:d=4,o=5,b=160:c.6,e6,f#6,8a6,g.6,e6,c6,8a,8f#,8f#,8f#,2g,8p,8p,8f#,8f#,8f#,8g,a#.,8c6,8c6,8c6,c6' },
  { id: 'looney', category: 'folk', title: 'Looney Tunes', tag: 'Merrie Melodies', rtttl: 'Looney:d=4,o=5,b=140:32p,c6,8f6,8e6,8d6,8c6,a.,8c6,8f6,8e6,8d6,8d#6,e.6,8e6,8e6,8c6,8d6,8c6,8e6,8c6,8d6,8a,8c6,8g,8a#,8a,8f' },
  { id: 'finalcountdown', category: 'pop', title: 'The Final Countdown', tag: 'Europe', rtttl: 'Final Countdown:d=16,o=5,b=125:b,a,4b,4e,p,8p,c6,b,8c6,8b,4a,4p,c6,b,4c6,4e,p,8p,a,g,8a,8g,8f#,8a,4g.,f#,g,4a.,g,a,8b,8a,8g,8f#,4e,4c6,2b.,b,c6,b,a,1b' },
  { id: 'bumblebee', category: 'classical', title: 'Flight of the Bumblebee', tag: 'Rimsky-Korsakov', rtttl: 'Bumblebee:d=16,o=5,b=140:a,g#,g,f#,f,e,d#,d,c#,c,b4,a#4,a4,a#4,b4,c,c#,d,d#,e,f,f#,g,g#,a,g#,g,f#,f,e,d#,d,c#,c,b4,a#4,a4,a#4,b4,c,c#,d,d#,e,4a' },
  { id: 'dasboot', category: 'screen', title: 'Das Boot', tag: 'Doldinger', rtttl: 'Das Boot:d=4,o=5,b=100:d#.4,8d4,8c4,8d4,8d#4,8g4,a#.4,8a4,8g4,8a4,8a#4,8d,2f.,p,f.4,8e4,8d4,8e4,8f4,8a4,c.,8b4,8a4,8b4,8c,8e,2g.,2p' },
  { id: 'macarena', category: 'dance', title: 'Macarena', tag: 'Los del Rio', rtttl: 'Macarena:d=4,o=5,b=180:f,8f,8f,f,8f,8f,8f,8f,8f,8f,8f,8a,8c,8c,f,8f,8f,f,8f,8f,8f,8f,8f,8f,8d,8c,p,f,8f,8f,f,8f,8f,8f,8f,8f,8f,8f,8a,p,2c.6,a,8c6,8a,8f,p,2p' },
  { id: 'scatman', category: 'dance', title: 'Scatman', tag: 'Scatman John', rtttl: 'Scatman:d=4,o=5,b=200:8b,16b,32p,8b,16b,32p,8b,2d6,16p,16c#.6,16p.,8d6,16p,16c#6,8b,16p,8f#,2p.,16c#6,8p,16d.6,16p.,16c#6,16b,8p,8f#,2p,32p,2d6,16p,16c#6,8p,16d.6,16p.,16c#6,16a.,16p.,8e,2p.,16c#6,8p,16d.6,16p.,16c#6,16b,8p,8b,16b,32p,8b,16b,32p,8b,2d6,16p,16c#.6,16p.,8d6,16p,16c#6,8b,16p,8f#,2p.,16c#6,8p,16d.6,16p.,16c#6,16b,8p,8f#,2p,32p,2d6,16p,16c#6,8p,16d.6,16p.,16c#6,16a.,16p.,8e,2p.,16c#6,8p,16d.6,16p.,16c#6,16a,8p,8e,2p,32p,16f#.6,16p.,16b.,16p.' },
  { id: 'wannabe', category: 'pop', title: 'Wannabe', tag: 'Spice Girls', rtttl: 'Wannabe:d=4,o=5,b=125:16g,16g,16g,16g,8g,8a,8g,8e,8p,16c,16d,16c,8d,8d,8c,e,p,8g,8g,8g,8a,8g,8e,8p,c6,8c6,8b,8g,8a,16b,16a,g' },
  { id: 'lindenstrasse', category: 'screen', title: 'Lindenstrasse', tag: 'TV Theme', rtttl: 'Linden:d=4,o=5,b=180:g,e,g,2c.6,2e.6,d.6,8e6,f6,2a,p,a,c6,a6,2g6,p,d6,e6,f6,2e6,c6,d6,e6,2d.6,2c.6,2b,p,g,e,g,2c.6,2e.6,d.6,8e6,f6,2a,p,a,c6,a6,2g6,p,d6,e6,f6,1d6,p,c6,1c6' },
  { id: 'eurovision', category: 'screen', title: 'Eurovision Theme', tag: 'Charpentier', rtttl: 'Eurovision:d=4,o=5,b=63:8c,8f,16f,16g,8a,8f,c6,8a,8a,8a#,16c6,16a#,16a,16a#,8c6,16g,16f,16g,16a,8g,8c,8f,16f,16g,8a,8f,c6,8a,8a,16a#,16c6,16a,16a#,g,16f,2f' },
  { id: 'ententanz', category: 'folk', title: 'Ententanz', tag: 'Birdie Song', rtttl: 'Ententanz:d=4,o=5,b=100:16g,16g,16a,16a,16e,16e,8g,16g,16g,16a,16a,16e,16e,8g,16g,16g,16a,16a,16c6,16c6,8b,8b,8a,8g,8f,16f,16f,16g,16g,16d,16d,8f,16f,16f,16g,16g,16d,16d,8f,16f,16f,16g,16g,16a,16b,8c6,8a,8g,8e,c' },
  { id: 'toccata', category: 'classical', title: 'Toccata and Fugue', tag: 'Bach', rtttl: 'Toccata:d=4,o=5,b=160:16a4,16g4,1a4,16g4,16f4,16d4,16e4,2c#4,16p,d.4,2p,16a4,16g4,1a4,8e.4,8f.4,8c#.4,2d4' },
  { id: 'bolero', category: 'classical', title: 'Bolero', tag: 'Ravel', rtttl: 'Bolero:d=4,o=5,b=80:c6,8c6,16b,16c6,16d6,16c6,16b,16a,8c6,16c6,16a,c6,8c6,16b,16c6,16a,16g,16e,16f,2g,16g,16f,16e,16d,16e,16f,16g,16a,g,g,16g,16a,16b,16a,16g,16f,16e,16d,16e,16d,8c,8c,16c,16d,8e,8f,d,2g' },
  { id: 'atb', category: 'dance', title: '9 PM Till I Come', tag: 'ATB', rtttl: '9PM:d=4,o=4,b=285:4a5,4a5,16a#5,8b.5,4a5,4p,4c6,4p,4c6,4p,4c6,8d.6,16c#6,4c6,4g5,2p.,4f5,4g5,16g#5,8a.5,4g5,4p,4a5,4p,4c6,4p,4c6,8d.6,16c#6,4c6,4g5' },
  { id: 'entchen', category: 'folk', title: 'Alle meine Entchen', tag: 'Kinderlied', rtttl: 'Entchen:d=4,o=5,b=120:c,d,e,f,2g,2g,a,a,a,a,2g,a,a,a,a,2g,f,f,f,f,2e,2e,d,d,d,d,2c' },
  { id: 'haenschen', category: 'folk', title: 'Haenschen klein', tag: 'Kinderlied', rtttl: 'Haenschen:d=4,o=5,b=120:g,e,2e,f,d,2d,c,d,e,f,g,g,2g,g,e,2e,f,d,2d,c,e,g,g,2c' },
  { id: 'auclair', category: 'folk', title: 'Au clair de la lune', tag: 'France', rtttl: 'Au clair:d=4,o=5,b=110:c,c,c,d,2e,2d,c,e,d,d,2c,c,c,c,d,2e,2d,c,e,d,d,2c' },
  { id: 'bella', category: 'folk', title: 'Bella Ciao', tag: 'Italian Folk', rtttl: 'Bella Ciao:d=8,o=5,b=140:e,a,b,4c6,4a,e,a,b,4c6,4a,e,a,b,4c6,b,a,4e6,e6,e6,e6,4e6,c6,d6,2e6' },
  { id: 'sandstorm', category: 'dance', title: 'Sandstorm', tag: 'Darude', rtttl: 'Sandstor:d=16,o=5,b=112:d6,d6,d6,d6,8d6,d6,d6,d6,d6,d6,d6,8d6,g6,g6,g6,g6,g6,g6,g6,g6,f6,f6,f6,f6,f6,f6,8f6,c6,c6,d6,d6,d6,d6,8d6,d6,d6,d6,d6,d6,d6,d6,d6,f6,f6,d6,d6,d6,d6,d6' },
  { id: 'cottoneye', category: 'dance', title: 'Cotton Eye Joe', tag: 'Rednex', rtttl: 'CottonEy:d=8,o=5,b=112:16d6,8f6,16d6,8f6,16d6,8f6,16d6,8d6,16c6,8d6.,8f6,8d6,8c6,16a#5,16a#5,16a#5,16p,16a#5,16a#5,16g5,16a#5' },
  { id: 'whatislove', category: 'dance', title: 'What Is Love', tag: 'Haddaway', rtttl: 'WhatIsLo:d=4,o=5,b=225:4c6,4b5,4c6,4a5,4c6,4b5,4c6,4a5,4c6,4b5,4c6,4g5,4c6,4b5,4c6,4g5,4b5,4a5,4b5,4g5,4b5,4a5,4b5,4g5,4b5,4a5,4b5,4g5,4b5,4a5,4b5,4g5' },
  { id: 'bluedabadee', category: 'dance', title: 'Blue (Da Ba Dee)', tag: 'Eiffel 65', rtttl: 'BlueDa-B:d=16,o=5,b=140:4a,4a#,8g,8a#,8c6,8f,8a,4a#,8g,8a#,8d6,4d#6,8d6,8c6,4a#,8g,8a#,8c6,8f,8a,4a#,8g,8a#,8d6,4d#6,8d6,8c6,4a#,8g,8a#,8c6,8f,8a,4a#,8g,8a#,8d6,4d#6,8d6,8c6,4a#,8g,8a#,8a,8f,8f,2g' },
  { id: 'mambo5', category: 'dance', title: 'Mambo No. 5', tag: 'Lou Bega', rtttl: 'MamboNo5:d=4,o=5,b=140:16a#,8a#,16a#,8a#,16a#,8c6,16c6,8a#,16p,8a#,c6,8a#,8p,16a#,8a#,16a#,8a#,16a#,8c6,16c6,8a#,16p,8a#,c6,8a#,8p,16a#,8d#6,16d#6,8d6,16d6,c6,16a#,16p,8a#,c6,8a#,8p,16a#,8d#6,16d#6,8d6,16d6,c6,16a#,16p,8a#,c6,8a#' },
  { id: 'barbie', category: 'dance', title: 'Barbie Girl', tag: 'Aqua', rtttl: 'BarbieGi:d=4,o=5,b=125:8g#,8e,8g#,8c#6,a,p,8f#,8d#,8f#,8b,g#,8f#,8e,p,8e,8c#,f#,c#,p,8f#,8e,g#,f#' },
  { id: 'boomboom', category: 'dance', title: 'Boom Boom Boom Boom', tag: 'Vengaboys', rtttl: 'BoomBoom:d=4,o=5,b=70:8a#,16g,16f,8a#,16g,16f,16d6,16d#6,16d6,16d#6,16f6,16d6,8a#,8a#,16g,16f,8a#,16g,f,8d6,8d6,8c6,a#,16f,16f,16f,16c6,16c6,a#,16g,16g,16g,16a#,16c6,8d6,8a#,16d#,16d#,16d#,16d#,16d#,8d,32a#,8d6,8d6,8c6,a#,16f,16f,16f' },
  { id: 'dragostea', category: 'dance', title: 'Dragostea Din Tei', tag: 'O-Zone', rtttl: 'Dragoste:d=8,o=5,b=160:4d6,c#6,4d6,4b.,b,c#6,b,a,2f#,d6,f#6,e6,d6,2a,a,e6,d6,c#6,d6,c#6,4b,b4,c#,b4,2b,p,b4,c#,b4,2a,p,b4,c#,b4,2a,p,b4,c#,b4,4d6,b' },
  { id: 'rhythmnight', category: 'dance', title: 'Rhythm of the Night', tag: 'Corona', rtttl: 'RhythmOf:d=16,o=5,b=63:g#,g#,g#,c#6,b,g#,f#,e,8c#.,8p,8b,b,8g#.,8p,8g#,4f#,8p,g#,c#6,b,g#,32f#,e.,8c#.' },
  { id: 'lambada', category: 'dance', title: 'Lambada', tag: 'Kaoma', rtttl: 'TheLamba:d=8,o=5,b=125:4d.6,c6,a#,a,4g,g,a#,a,g,f,g,d,c,2d.,4d.6,c6,a#,a,4g,g,a#,a,g,f,g,d.,c,2d,c6,c6,c6,a#,4d#,d#,g,d.6,c.6,a#,4d#,g,a#,4a,g,f,4f,g,f,2g' },
  { id: 'thesign', category: 'dance', title: 'The Sign', tag: 'Ace of Base', rtttl: 'TheSign:d=4,o=5,b=100:8g#6,8f#6,8g#6,16f#6,8a#6,16p,8g#6,16f#6,8g#6,16p,8g#6,8f#6,16g#6,8a#6,16p,8g#6,16f#6,8g#6' },
  { id: 'luftballons', category: 'ndw', title: '99 Luftballons', tag: 'Nena', rtttl: '99Luftba:d=4,o=5,b=100:8c#7,16e#7,8c#7,16p,8e#7,8d#7,16c#7,16a#6,16p,16a#6,16p,16a#6,16f#7,16p,16f#7,8p,16f#7,16p,8f#7,16e#7,8d#7,16p,8c#7,8d#7,8e#7,8e#7,8d#7,16c#7,16a#6,16p,16a#6,16p,16a#6,8c#7,16a#6,8c#7,8c#6,16a#6,8c#7,16d#7' },
  { id: 'majortom', category: 'ndw', title: 'Major Tom', tag: 'Peter Schilling', rtttl: 'MajorTom:d=4,o=6,b=35:32p,16d.,32d.,32d.,16d.,16d.,16b.5,16d.,32d.,32c,32b5,8a5,16c.,16e.,16e.,8d,16b.5,16d.,16d,32c,32b5,8a5,8c,8e,8e,8f#,8g.' },
  { id: 'amadeus', category: 'ndw', title: 'Rock Me Amadeus', tag: 'Falco', rtttl: 'RockMeAm:d=4,o=5,b=355:a#,a#,a#,2f6,a#,a#,2d#6,a#,a#,2c#6,a#,2c6,a#,a#,a#,2f6,a#,a#,2d#6,a#,a#,2c#6,a#,2c6,a#,a#,a#,2f6,a#,a#,2d#6,a#,a#,2c#6,a#,2c6,1a#,p,p,a#,a#,a#,a#,a#,a#,f6,1f6,2a#,a#,f6,f6,a#,a#,a#,a#,a#,a#,f6,1f6,2a#,a#,f6,f6,a#,a#,a#,a#,a#,a#,f6,1f6,2g#,2g#,g#,g#,g#,g#,8a#.' },
  { id: 'foreveryoung', category: 'ndw', title: 'Forever Young', tag: 'Alphaville', rtttl: 'ForeverY:d=4,o=5,b=100:16a#6,8c#7,16a#6,8a#6,8p,16f#6,16g#6,16g#6,8g#6,16a#6,8g#6,8g#6,p,8p,16f#6,16f#6,16f#6,16f#6,16g#6,16g#6,8g#6,16f#6,8d#6,8p,16f#6,8d#6,8c#6,8p,16f#6,8g#6,8f#6' },
  { id: 'themodel', category: 'ndw', title: 'The Model', tag: 'Kraftwerk', rtttl: 'TheModel:d=8,o=5,b=125:4a.,a,c6,a,c6,a,4e.,e,g,e,4g,4a.,a,c6,a,c6,a,4e.,e,g,e,4g,4a,4a,a,c6,b,a,4b.,g,4e.,e,2a,c6,b,a,4b.,g,2e,4a,4a,a,c6,b,a,4b.,g,4e.,e,2a,c6,b,a,4b.,g,4e' },
  { id: 'tourdefrance', category: 'ndw', title: 'Tour de France', tag: 'Kraftwerk', rtttl: 'TourDeFr:d=4,o=5,b=285:c,p,e,f,g,2p,e,g,a,e,f,g,p,c6,p,1a#,1p,c,p,e,f,g,2p,e,g,a,e,f,g,p,c6,p,1d6' },
  { id: 'sweetdreams', category: 'ndw', title: 'Sweet Dreams', tag: 'Eurythmics', rtttl: 'SweetDre:d=8,o=5,b=125:4d#,4d#,c,4d#,4d#,d#,4d.,p,d#,d#,c,4d#.,4c,d#,d#,4f.,d#,4d,16c,16p,d#,d#,c,4d#.,d#,c,d#,d#,16f,16p,d#,4d.,p,4d#,c,4d#,4c,p,d#,d#,f,d#,16d,16p,4d,p,g,g,4c,g,g,c,g,f,4f,2p,g,g,4c,g,g,c,4g,4g#.,g,4f,p,g,g,4c,g,g,c,g,f,4f,2p,g,g,4c,g,g,c,4g,4g#.,g,4f' },
  { id: 'bluemonday', category: 'ndw', title: 'Blue Monday', tag: 'New Order', rtttl: 'BlueMond:d=8,o=6,b=140:f,f,f,g,c,c,c,d,4d,d,4d,d,4d,f,f,f,g,c,c,c,d,4d,d,4d,d,4d,16d5,p,16d5,p,16d5,p,16d5,4p.,16d5,p,16d5,p,16d5,p,16d5,4p.,f5,f,f5,f,c5,c,c5,c,d5,d,d5,d,d5,d,d5,d,g5,g,g5,g,c5,c,c5,c,d5,d,d5,d,d5,d,d5,d' },
  { id: 'jeanny', category: 'ndw', title: 'Jeanny', tag: 'Falco', rtttl: 'Jeanny:d=4,o=6,b=112:8g,8g,p,16g5,16p,8p,8g,8g,8f,8g,g,d,16d5,16p,8p,8g,8g,p,16g5,16p,8g,8g,8g,8f,8g,g,d,8d,8d,8c,8a#5,a#5,a#5,8a#5,8a#5,8d,8d#,f,a#5,p,16c5,16p,8p,8c,8d,16c5,16p,8d#,p,16d5,16p,8p,8d,8d,16d5,16p,8d,p,8g5' },
  { id: 'roboter', category: 'ndw', title: 'Die Roboter', tag: 'Kraftwerk', rtttl: 'DieRobot:d=4,o=5,b=100:8c#6,8p,16c#6,16p,16c#6,16e#6,16p,16c#6,16p,16c#6,8p,16d#7,16p,16p,16a#7,16p,16g#7,8p,16c#6' },
  { id: 'neonlights', category: 'ndw', title: 'Neon Lights', tag: 'Kraftwerk', rtttl: 'Neonligh:d=4,o=5,b=100:8e#7,16p,16d#7,8d#7,8p,16c#7,8c#6,16a#6,8e#7,16p,16d#7,8d#7,8p,8c#7,16a#6,8e#7,16p,16a#6,8a#6,8p,16c#7,8d#7,16e#7,8e#7,16p,8d#7' },
  { id: 'riddle', category: 'ndw', title: 'The Riddle', tag: 'Nik Kershaw', rtttl: 'TheRiddl:d=4,o=6,b=140:d5,8e5,8f5,8f5,8g5,8f5,8e5,d5,8c5,8d5,8d5,8e5,8e5,8p,d5,8e5,8f5,8g5,8f5,8e5,d5,8c5,8d5,8d5,8c5,8c5,8p,8b5,8a5,8g5,8f5,8e5,8d5,c5,d5' },
  { id: 'pippi', category: 'screen', title: 'Pippi Longstocking', tag: 'Kids TV', rtttl: 'PippiLon:d=4,o=6,b=250:g5,c,e,c,d,p,8f,8e,8d,8c,b5,d,g5,b5,2c,e,p,g5,c,e,c,d,p,8f,8e,8d,8c,b5,d,g5,b5,2c,2p,2e,e,e,2f,f,8f,8e,d,8d,8d,d,8c,8c,b5,c,d,p,2e,e,e,2f,f,e,d,d,c,b5,1c' },
  { id: 'biene', category: 'screen', title: 'Biene Maja', tag: 'Kids TV', rtttl: 'BieneMaj:d=4,o=6,b=125:g5,a5,b5,8c,8b5,8b5,8a5,8a5,8g5,8g5,8c5,d5,a.5,p,8b5,8a5,8g5,8g5,8f5,8f5,8d5,c5,c.,p,e.,8c5,8c5,8g5,8g5,8e5,f.5,p.,d.,8b5,8b5,8g5,8g5,8f5,e.5' },
  { id: 'smurfs', category: 'screen', title: 'The Smurfs', tag: 'Kids TV', rtttl: 'Smurfs:d=32,o=5,b=200:4c6,16p,4f6,p,16c6,p,8d6,p,8a#,p,4g,16p,4c6,p,16a,p,8f,p,8a,p,4g,4p,g,g#,a,a#,b,4c6,16p,4f6,p,16c6,p,8d6,p,8a#,p,4g,16p,4c6,p,16a,p,8a#,p,8e,p,4f' },
  { id: 'dancingqueen', category: 'pop', title: 'Dancing Queen', tag: 'ABBA', rtttl: 'DancingQ:d=4,o=5,b=100:8e7,8d7,8d7,8d7,16p,8e7,8d7,8d7,8d7,8e7,8c7,16d7,8d7,16d7,16d7,8d6,16c7,16c6,8a6,8e7,16d7,8d7,8c7,8c6,8c7,16c7,8c7,8c6,16c7,8c7,8c7,8c7,16d7,8c7,16c6,16c6,8c7' },
  { id: 'waterloo', category: 'pop', title: 'Waterloo', tag: 'ABBA', rtttl: 'Waterloo:d=4,o=5,b=100:16f#6,16f#6,16a#6,8a#6,16p,16a#6,16a#6,16a#6,16a#6,16g#6,16g#6,16g#6,16f#6,16f#6,16g#6,8g#6,16p,16g#6,16g#6,16a#6,8a#6,16p,16a#6,16a#6,16a#6,16a#6,16a#6,16a#6,16a#6,16g#6,16g#6,16f#6,16f#6' },
  { id: 'wewillrockyou', category: 'pop', title: 'We Will Rock You', tag: 'Queen', rtttl: 'WeWillRo:d=4,o=6,b=100:f5,e5,d5,c5,8d5,8d5,p,8d5,8d5,p,f5,e5,d5,c5,8d5,8d5,p,8d5,8d5' },
  { id: 'africa', category: 'pop', title: 'Africa', tag: 'Toto', rtttl: 'Africa:d=8,o=6,b=100:16f#,16f#,16f#,f#.,16f#,f#.,g#,16a#,2b,16d#,d#.,e,f#,f#,16e.,e,d#,4c#,c#,b5,4d#,16c#,b5,2c#,16f#,16f#,4f#,16f#,f#.,g#,16a#,2b,16d#,16d#,16d#,e,f#,f#.,e,e,16d#.,4c#,c#,b5,4d#.,16c#,b5,2c#' },
  { id: 'joyride', category: 'pop', title: 'Joyride', tag: 'Roxette', rtttl: 'Joyride:d=4,o=5,b=100:16c#7,8c#7,16p,16c#6,8a#6,16p,16a#6,16a#6,8g#6,16p,16c#6,16c#6,16c#6,16d#6,16d#6,8e#6,8e#6' },
];

// --- Full-length songs (classical / folk / original), built from sections ---------------------------------
// rt(name, d, o, b, ...sections): each section is an RTTTL note string, or [notes, semitoneShift, speed]
// to transpose it and/or scale its note values (speed 2 = twice as fast, 0.5 = half).
const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const TOKEN = /^(\d+)?([a-gp])(#)?(\.)?(\d+)?(\.)?$/;
function rt(name, d, o, b, ...sections) {
  const out = [];
  for (const sec of sections) {
    const [txt, shift = 0, speed = 1] = Array.isArray(sec) ? sec : [sec];
    for (const raw of txt.split(',')) {
      const tok = raw.trim();
      if (!tok) continue;
      const m = TOKEN.exec(tok);
      if (!m) throw new Error(`${name}: bad token "${tok}"`);
      const dur = (m[1] ? +m[1] : d) / speed;
      const dot = m[4] || m[6] || '';
      if (m[2] === 'p') { out.push(`${dur}p${dot}`); continue; }
      const midi = 12 * ((m[5] ? +m[5] : o) + 1) + SEMI[m[2]] + (m[3] ? 1 : 0) + shift;
      out.push(`${dur}${NAMES[midi % 12]}${dot}${Math.floor(midi / 12) - 1}`);
    }
  }
  return `${name}:d=${d},o=${o},b=${b}:${out.join(',')}`;
}

const ODE_A = 'e,e,f,g,g,f,e,d,c,c,d,e,e.,8d,2d';
const ODE_A2 = 'e,e,f,g,g,f,e,d,c,c,d,e,d.,8c,2c';
const ODE_B = 'd,d,e,c,d,8e,8f,e,c,d,8e,8f,e,d,c,d,2g4';
const ODE_PASS = [ODE_A, ODE_A2, ODE_B, ODE_A2];

const CANON_GROUND = [
  '2f#,2e,2d,2c#,2b4,2a4,2b4,2c#',
  '4f#,4f#,4e,4e,4d,4d,4c#,4c#,4b4,4b4,4a4,4a4,4b4,4b4,4c#,4c#',
  '4d,4f#,4a,4a,4g,4b,4a,4f#,4d,4d,4f#,4a,4a,4b,4c#6,4a',
  '8d,8f#,8a,8f#,8g,8b,8a,8f#,8d,8f#,8a,8f#,8a,8b,8c#6,8a',
  '8f#,8g,8a,8f#,8g,8a,8a4,8b4,8c#,8d,8e,8f#,8g,8f#,8d,8e',
  '8f#,8f#4,8g4,8a4,8g4,8f#4,8e4,8f#4,8d,8e,8f#,8g,8a,8b,8g,8b',
  '8a,8d6,8c#6,8d6,8a,8d6,8c#6,8d6,8g,8b,8a,8b,8f#,8a,8g,8f#',
  '16d,16f#,16a,16f#,16d,16f#,16a,16f#,16a4,16c#,16e,16c#,16a4,16c#,16e,16c#',
  '16b4,16d,16f#,16d,16b4,16d,16f#,16d,16f#4,16a4,16c#,16a4,16f#4,16a4,16c#,16a4',
  '16g4,16b4,16d,16b4,16g4,16b4,16d,16b4,16d,16f#,16a,16f#,16d,16f#,16a,16f#',
  '16g4,16b4,16d,16b4,16g4,16b4,16d,16b4,16a4,16c#,16e,16c#,16a4,16c#,16e,16c#',
];

const ELISE_A = 'e,d#,e,d#,e,b5,d,c,8a5,p,c5,e5,a5,8b5,p,e5,g#5,b5,8c6,p,e5';
const ELISE_A_END1 = 'e,d#,e,d#,e,b5,d,c,8a5,p,c5,e5,a5,8b5,p,e5,c6,b5,8a5,p';
const ELISE_B = '8p,b5,c,d,8e,p,g5,f,e,8d,p,f5,e,d,8c,p,e5,d,c,8b5,p,e5,e6,p,p,e6,e7,p,p,d#6,e6,p,p,d#6,e6,d#6,e6,d#6,e6,d#6,e6,d#6,e6,d#6,e6,b,d,c,8a5';
const ELISE_C = '8c5,e5,g5,8c6,p,g5,e6,d6,c6,8g5,p,f5,e6,d6,c6,8f5,p,e5,d6,c6,b5,8e5,p,e5,e6,p,p,e6,e7,p,p,d#6,e6,p,p,d#6,e6,d#6,e6,d#6,e6,d#6,e6,d#6,e6,d#6,e6,b,d,c,8a5';

const TURKISH_A = 'b,a,g#,a,4c6,d6,c6,b,c6,4e6,f6,e6,d#6,e6,b6,a6,g#6,a6,b6,a6,g#6,a6,4c7,8a6,4c7';
const TURKISH_B = '8e,8a,8e,8a,8e,8a,8e,8a,8d,8a,8d,8a,8c,8a,8c,8a,8b4,8e,8b4,8e,8c,8e,8d,8e,4a,4p';
const TURKISH_C = '8c6,8e6,8g6,8e6,8c6,8e6,8g6,8e6,8d6,8f6,8a6,8f6,8d6,8f6,8a6,8f6,8e6,8g6,8c7,8g6,8e6,8g6,8c7,8g6,4c7,4p';

const MOUNTAIN = 'e,f#,g,a,b,g,4b,a#,f#,4a#,a,e,4a,e,f#,g,a,b,g,b,e6,d6,b,g,b,4d6,4p';

const ENT_A = 'd,d#,e,4c6,e,4c6,e,2c6,c6,d6,d#6,e6,c6,d6,4e6,b,4d6,2c6,d,d#,e,4c6,e,4c6,e,2c6,p,a,g,f#,a,4c6,e6,d6,c6,a,4d6,4p';
const ENT_B = '4p,8c6,8d6,8e6,8c6,8e6,8c6,8e6,4g6,8f6,8e6,8d6,8e6,8f6,8e6,8d6,4c6,4p,8a,8b,8c6,8a,8c6,8a,8c6,4e6,8d6,8c6,8b,8c6,8d6,8c6,8b,4a,4p';
const ENT_C = '8g,8g,4a,8g,8e,4c6,8e,8d,4c,8d,8e,8f,8g,8a,2g,8g,8g,4a,8g,8e,4c6,8e,8d,8c,8d,8e,8c,4c,4p';

const MINUET = '4d6,8g5,8a5,8b5,8c6,4d6,4g5,4g5,4e6,8c6,8d6,8e6,8f#6,4g6,4g5,4g5,4c6,8d6,8c6,8b5,8a5,4b5,8c6,8b5,8a5,8g5,4f#5,8g5,8a5,8b5,8g5,2a5,4p';
const MINUET_B = '4b5,8g5,8a5,8b5,8g5,4a5,8d5,8e5,8f#5,8d5,4g5,8e5,8f#5,8g5,8d5,4c#6,8a5,8b5,8c#6,8a5,2d6,4p';

const GREEN_V = '8a,2c6,8d6,e6.,8f6,e6,2d6,8b,2g,8a,b.,8c6,2a,8a,a.,8g#,8a,2b,8g#,2e,4p';
const GREEN_C = '8g6,e6.,8f6,e6,2d6,8b,2g,8a,b.,8c6,b,8a,g#.,8f#,g#,2a,4p';
const GREEN_C0 = '4g6,e6,8f6,e6,d6,8b,g,8a,b.,8c6,2a,8a,2a,4p';

const GRACE_V = '8d,g.,8b,g,b,2a,8g,2e,8d,8d,g.,8b,g,b,2a,d6.,8b,d6,b,g,2d,8d,g.,8b,g,b,a.,8g,2e,d6,b,g,a,2g,4p';

const LULLABY_A = 'e,e,2g,e,e,2g,e,g,c6,b,a,a,2g,d,e,f,d,d,e,f,d,f,b,a,g,c6,2c6';
const LULLABY_B = 'e,g,c6,b,a,a,g,e,g,c6,b,a,a,g,e,g,c6,b,c6,d6,2c6,d,e,f,d,f,b,a,g,c6,2c6';


export const FULL_SONGS = [
  { id: 'ode-full', category: 'classical', title: 'Ode to Joy (Full)', tag: 'Beethoven',
    rtttl: rt('Ode Full', 4, 5, 132, ...ODE_PASS, [ODE_PASS.join(','), 0, 2], [ODE_PASS.join(','), 12], [ODE_A, 12], [ODE_A2 + ',2p', 12, 1]) },
  { id: 'canon-full', category: 'classical', title: 'Canon in D (Full)', tag: 'Pachelbel',
    rtttl: rt('Canon Full', 4, 5, 90, ...CANON_GROUND, [CANON_GROUND[4], 12], [CANON_GROUND[7], 12], '1d6') },
  { id: 'elise-full', category: 'classical', title: 'Fur Elise (Full)', tag: 'Beethoven',
    rtttl: rt('Elise Full', 16, 6, 125, ELISE_A, ELISE_A_END1, ELISE_A, ELISE_A_END1, ELISE_B, ELISE_A, ELISE_A_END1, ELISE_C, ELISE_C, ELISE_A, ELISE_A_END1, ELISE_B, ELISE_B, ELISE_A, ELISE_A_END1, ELISE_C, ELISE_A, ELISE_A_END1, '1a5') },
  { id: 'turkish-full', category: 'classical', title: 'Turkish March (Full)', tag: 'Mozart',
    rtttl: rt('Turkish Full', 16, 5, 130, TURKISH_A, TURKISH_A, TURKISH_B, TURKISH_B, TURKISH_A, TURKISH_C, TURKISH_C, TURKISH_A, TURKISH_B, TURKISH_B, TURKISH_A, [TURKISH_C, 0, 1], [TURKISH_C, 5], [TURKISH_A, 0, 1], TURKISH_A, TURKISH_B, TURKISH_A, '1a6') },
  { id: 'mountain-full', category: 'classical', title: 'Mountain King (Full)', tag: 'Grieg',
    rtttl: rt('Mountain Full', 8, 5, 100, [MOUNTAIN, 0, 0.5], [MOUNTAIN, 0, 0.5], MOUNTAIN, [MOUNTAIN, 2], [MOUNTAIN, 2, 2], [MOUNTAIN, 4, 2], [MOUNTAIN, 5, 2], [MOUNTAIN, 7, 2], [MOUNTAIN, 12, 2], '1e6') },
  { id: 'entertainer-full', category: 'folk', title: 'The Entertainer (Full)', tag: 'Joplin',
    rtttl: rt('Entertainer Full', 8, 5, 140, ENT_A, ENT_B, ENT_A, ENT_C, ENT_A, ENT_B, ENT_A, ENT_C, [ENT_A, 12], '1c6') },
  { id: 'minuet-full', category: 'classical', title: 'Minuet in G (Full)', tag: 'Petzold',
    rtttl: rt('Minuet Full', 4, 5, 120, MINUET, MINUET, MINUET_B, MINUET, [MINUET_B, 12], [MINUET, 12], '1g5') },
  { id: 'greensleeves-full', category: 'folk', title: 'Greensleeves (Full)', tag: 'Folk',
    rtttl: rt('Greensleeves Full', 4, 5, 100, GREEN_V, GREEN_C, GREEN_V, GREEN_C, [GREEN_V, 12], [GREEN_C, 12], GREEN_C0, '1a') },
  { id: 'grace-full', category: 'folk', title: 'Amazing Grace (Full)', tag: 'Hymn',
    rtttl: rt('Grace Full', 4, 5, 90, GRACE_V, GRACE_V, [GRACE_V, 2], [GRACE_V, 12, 1], '1g') },
  { id: 'lullaby-full', category: 'classical', title: 'Lullaby (Full)', tag: 'Brahms',
    rtttl: rt('Lullaby Full', 4, 5, 110, LULLABY_A, LULLABY_B, [LULLABY_A, 0, 2], [LULLABY_B, 12], [LULLABY_A, 12], '1c6') },
];
SONGS.push(...FULL_SONGS);
