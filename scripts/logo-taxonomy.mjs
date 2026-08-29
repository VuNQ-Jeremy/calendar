// Logo taxonomy for the ipaslogo mascot library.
//
// Level 1 is one of BUCKETS; level 2 is the subject head noun pulled out of the
// filename slug. Both the lexicon and the overrides below are hand-authored --
// no model call is involved, so classification is deterministic and reviewable.
//
// Used by scripts/import-logos.mjs to generate the logo_library seed SQL.

export const BUCKETS = [
  'mammal',
  'bird',
  'sea-life',
  'reptile-amphibian',
  'insect-arachnid',
  'plant',
  'food-drink',
  'household-object',
  'tech-robot',
  'vehicle',
  'mythic-character',
  'nature-cosmic',
];

const g = (bucket, words) =>
  words
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [w, bucket]);

export const LEXICON = new Map([
  ...g(
    'mammal',
    `
    dog puppy pup cat kitten fox raccoon otter bear rabbit bunny panda hamster deer squirrel
    elephant lion tiger monkey pig piglet sheep goat giraffe horse cow calf bull ram donkey mole
    capybara koala hippopotamus hippo rhinoceros rhino lemur leopard wolf mouse tapir pangolin
    badger beaver bison boar buffalo camel cheetah chimpanzee chinchilla chipmunk coyote dingo
    elk ferret gazelle gerbil gibbon groundhog hare hedgehog hyena ibex impala jaguar jackal
    kangaroo lamb llama alpaca lynx marmot meerkat mink mongoose moose mule muskrat ocelot okapi
    opossum orangutan oryx ox panther platypus polecat porcupine possum puma quokka quoll rat
    reindeer sable serval shrew skunk sloth stoat tamarin tanuki vicuna vole wallaby warthog
    weasel wildebeest wombat yak zebra zebu bat bobcat cougar dormouse echidna fennec gopher
    hyrax jerboa numbat pika hog foal fawn cub joey antelope aardvark armadillo
    terrier poodle retriever shepherd spaniel collie corgi dachshund chihuahua beagle bulldog
    schnauzer husky labrador dalmatian pomsky shiba inu samoyed akita malamute maltese pug
    rottweiler whippet greyhound pointer setter sheepdog mastiff newfoundland papillon pekingese
    pinscher pomeranian saluki vizsla weimaraner borzoi keeshond
    tabby calico shorthair longhair siamese persian ragdoll bengal sphynx nebelung birman bombay
    burmese chartreux himalayan korat manx ocicat somali tonkinese abyssinian
  `,
  ),
  ...g(
    'bird',
    `
    owl penguin duck duckling chick chicken hen rooster pelican puffin toucan parrot macaw
    flamingo peacock swan goose gosling crow raven magpie sparrow finch wren hummingbird
    kingfisher heron stork ibis egret albatross gull tern petrel cormorant kiwi kakapo kea
    cockatoo budgie lovebird canary starling swallow woodpecker toucanet hornbill quail
    partridge pheasant turkey peahen dove pigeon eagle hawk falcon kestrel osprey vulture
    condor buzzard bird nightingale lark oriole tanager warbler bluebird cardinal jay
    chickadee nuthatch titmouse avocet puffling owlet
  `,
  ),
  ...g(
    'sea-life',
    `
    shark octopus squid jellyfish crab lobster shrimp prawn krill starfish seahorse nautilus
    clam oyster scallop mussel urchin anemone coral kelp plankton manatee dugong orca beluga
    narwhal porpoise dolphin whale seal walrus stingray manta ray skate eel cod salmon trout
    tuna herring sardine anchovy mackerel bass carp koi goldfish guppy angelfish clownfish
    pufferfish lionfish swordfish marlin barracuda grouper snapper flounder halibut sole
    sturgeon jelly amiskwia trilobite ammonite anglerfish cuttlefish barnacle limpet abalone
    conch periwinkle cockle whelk fish seaweed seagrass krill nudibranch
  `,
  ),
  ...g(
    'reptile-amphibian',
    `
    turtle tortoise frog toad salamander newt axolotl gecko lizard iguana chameleon skink
    komodo snake python cobra viper adder boa anaconda rattlesnake crocodile alligator caiman
    gharial tuatara terrapin treefrog bullfrog tadpole basilisk
  `,
  ),
  ...g(
    'insect-arachnid',
    `
    bee wasp hornet bumblebee ant termite beetle scarab ladybug ladybird firefly moth butterfly
    caterpillar dragonfly damselfly mantis grasshopper cricket locust cicada aphid weevil
    spider tarantula scorpion centipede millipede snail slug worm earthworm silkworm mayfly
    glowworm chrysalis cocoon
  `,
  ),
  ...g(
    'plant',
    `
    tree sapling seedling sprout sprouting seed acorn leaf fern moss lotus cactus mushroom
    fungus fungi bamboo bonsai baobab maple ginkgo oak pine spruce fir birch willow cedar
    cypress redwood palm fiddlehead frond bud bloom blossom flower tulip orchid sunflower lily
    rose daisy lavender snowdrop poppy peony iris dahlia marigold jasmine hibiscus magnolia
    camellia monstera succulent aloe sundew flytrap moonflower clover ivy vine shrub grass
    reed cattail thistle dandelion toadstool truffle lichen algae sprig twig branch root bulb
    pollen nectar petal stem crop wheat barley oat chestnut pinecone conker sequoia wisteria
    fuchsia begonia petunia zinnia crocus hyacinth freesia anemone-flower
  `,
  ),
  ...g(
    'food-drink',
    `
    bread loaf bun roll croissant pastry cake cookie biscuit waffle pancake donut doughnut
    muffin cupcake pie tart pudding custard mochi dumpling arancini pizza sandwich burger taco
    burrito sushi onigiri ramen noodle pasta soup stew curry rice popcorn pretzel cracker chip
    candy chocolate caramel toffee nougat marshmallow gelato sorbet sundae parfait yogurt
    cheese butter honey jam syrup coffee tea latte espresso cappuccino matcha cocoa milkshake
    smoothie juice lemonade soda cola beer wine sake cider kombucha egg bacon sausage ham steak
    apple banana orange lemon lime plum peach pear cherry grape berry strawberry blueberry
    raspberry blackberry mango papaya pineapple melon watermelon coconut fig date apricot
    nectarine pomegranate persimmon lychee durian avocado tomato potato carrot onion garlic
    pepper cucumber pumpkin squash eggplant broccoli cabbage lettuce spinach bean pea lentil
    nut almond walnut peanut cashew pistachio hazelnut sugar salt spice cinnamon vanilla mint
    basil scone brioche baguette bagel toast jelly-bean gumdrop lollipop macaron tiramisu
  `,
  ),
  ...g(
    'household-object',
    `
    teapot pot kettle cup mug glass bottle jar flask thermos jug pitcher bowl plate dish spoon
    fork knife whisk ladle spatula grater strainer colander mortar pestle cooker toaster blender
    mixer oven stove microwave fridge freezer sink faucet tap moka press grinder percolator
    lamp lantern candle chandelier sconce clock alarm timer hourglass sundial
    chair table desk bench stool sofa couch bed shelf cabinet drawer wardrobe
    box crate basket bucket bin barrel chest trunk suitcase backpack bag purse wallet pouch
    book notebook pencil pen ink eraser ruler stapler clip pin paper envelope stamp scissors
    tape glue brush comb mirror frame vase planter watering can broom mop vacuum dustpan
    sponge towel soap umbrella hat cap scarf glove sock shoe boot slipper mitten coat jacket
    key lock keychain compass telescope binoculars magnifier lens yarn thread needle button
    ribbon bell whistle mailbox postbox fountain signpost pillow cushion blanket quilt rug
    carpet curtain scale meter thermometer balloon kite toy doll teddy marble dice puzzle
    drum guitar piano violin flute trumpet trombone saxophone harp banjo ukulele accordion
    tambourine xylophone cello clarinet oboe harmonica maraca phonograph gramophone radio
    cassette record turntable speaker headphones microphone camera projector film slide
    mallet forge anvil hammer wrench screwdriver saw drill nail screw bolt rope chain ladder
    bucket-well birdhouse lunchbox teacup saucer tray napkin apron mitt
  `,
  ),
  ...g(
    'tech-robot',
    `
    robot bot droid android automaton mech mecha cyborg rover drone machine engine gear cog
    piston turbine generator battery cell circuit chip processor computer laptop keyboard
    monitor screen phone tablet console controller joystick floppy disk cartridge capsule pod
    module core reactor satellite antenna dish signal transmitter receiver beacon radar sonar
    lightbulb bulb switch plug socket wire cable magnet observatory probe sensor scanner
    printer modem router server terminal
  `,
  ),
  ...g(
    'vehicle',
    `
    car truck bus van tram trolley train locomotive monorail subway wagon carriage bicycle bike
    motorcycle scooter skateboard boat ship sailboat yacht canoe kayak raft ferry tugboat
    submarine airplane plane jet helicopter glider airship blimp zeppelin rocket shuttle
    spaceship spacecraft lander cart tractor bulldozer excavator forklift ambulance firetruck
    taxi sled sleigh gondola cablecar dinghy skiff hovercraft
  `,
  ),
  ...g(
    'mythic-character',
    `
    dragon phoenix griffin gryphon unicorn pegasus qilin kirin kitsune yeti sasquatch kraken
    hydra chimera sphinx minotaur centaur mermaid siren nymph dryad fairy sprite pixie elf
    dwarf gnome goblin orc troll ogre ghost spirit wraith phantom specter poltergeist wizard
    witch sorcerer mage warlock druid oracle seer shaman knight paladin warrior samurai ninja
    pirate viking golem homunculus familiar guardian keeper sentinel angel demon imp djinn
    genie elemental creature beast monster mascot totem idol king queen prince princess jester
    bard alchemist scholar hermit wanderer
  `,
  ),
  ...g(
    'nature-cosmic',
    `
    moon sun star planet comet meteor asteroid galaxy nebula constellation cosmos aurora eclipse
    orbit cloud rain snow storm thunder lightning rainbow fog mist frost ice icicle hail wind
    breeze tornado hurricane mountain volcano hill cliff canyon valley cave crystal gem geode
    stone pebble rock boulder sand dune desert glacier iceberg river stream lake pond ocean sea
    wave waterfall spring geyser fire flame ember spark ash smoke lava magma bubble droplet
    dewdrop puddle forest grove meadow field island reef prism portal rune sigil glyph heart
    hole shadow dawn dusk twilight tide horizon
  `,
  ),
]);

// Pose / colour / expression / body-part tokens that never name the subject.
export const MODIFIERS = new Set(
  `
  left right front back side up down low high top bottom near far close open closed
  face faced head eyes eye eyed ear ears eared nose nosed muzzle mouth cheek cheeks chin
  brow forehead paw paws foot feet leg legs arm arms hand belly tail tailed wing winged
  horn horned tooth teeth whisker whiskers fur mane snout body
  peek peeking peer glance look looking gaze stare watch
  smile smiling grin grinning laugh happy cheerful joyful merry glad content pleased
  calm serene peaceful gentle soft tender warm cozy sleepy drowsy dozing tired resting
  curious alert eager keen bright lively playful spirited perky bouncy
  shy timid bashful coy quiet still silent proud brave bold strong mighty
  sad glum wistful dreamy dream
  round rounded oval square boxy blocky chubby plump stout stocky slim slender lean
  small tiny mini miniature little big large huge grand tall short long wide broad narrow
  thin thick compact wee giant baby young
  fluffy furry shaggy smooth sleek glossy matte velvet velvety silky woolly
  spotted striped patched dappled speckled mottled
  pale dark deep rich muted dusty
  red orange yellow green blue navy teal cyan purple violet magenta pink brown tan beige
  cream ivory white black gray grey silver gold golden bronze copper charcoal slate ochre
  amber rust maroon burgundy olive sage salmon blush lilac indigo azure turquoise glaucous
  terracotta denim
  classic simple plain basic standard regular normal common single set pair trio group
  mixed assorted various multi inspired themed styled version variant type kind sort style
  form shape new old vintage retro modern
  bg background fg foreground of the a an and with in on at for
  arctic siberian australian english french german irish scottish welsh american african
  asian european nordic alpine tropical polar
  upright seated sitting standing lying curled tucked perched
`
    .split(/\s+/)
    .filter(Boolean),
);

// Second pass over the corpus: head nouns the base lexicon missed — obscure
// fauna, hand tools, instruments, Cambrian fauna, microbiology, built
// structures and fantasy artifacts. Authored by hand (no API call).

for (const [w, b] of [
  ...g(
    'mammal',
    `
    gorilla capuchin tarsier galago bushbaby colugo tamandua anteater aardwolf addax agouti
    anoa babirusa bandicoot bharal bilby binturong bontebok cacomistle chevrotain coati desman
    dhole dik duiker falanouc fossa genet gerenuk grison jackrabbit jaguarundi kinkajou
    klipspringer kowari kudu linsang mara margay markhor moonrat muntjac peccary potoroo pudu
    serow solenodon springhare takin tayra viscacha yapok zorilla civet boxer basset aye
    tenrec springbok sitatunga
  `,
  ),
  ...g('bird', `cassowary frogmouth hoatzin potoo shoebill robin`),
  ...g(
    'sea-life',
    `
    blobfish coelacanth hatchetfish lumpfish mudskipper paddlefish sawfish boxfish batfish
    seadragon isopod salp pyrosome tunicate lancelet glaucus nudibranch aegirocassis hurdia
    opabinia odaraia waptia sidneyia leanchoilia naraoia cambroraster emeraldella isoxys tuzoia
    sanctacaris titanokorys kimberella nectocaris vetulicola tullimonstrum hibbertopterus triops
    amoeba euglena paramecium volvox vorticella stentor diatom radiolarian foraminifera
    choanoflagellate coccolithophore dinoflagellate heliozoan placozoan rotifer gastrotrich
    loriciferan xenophyophore planarian desmid cyanobacterium bacterium
  `,
  ),
  ...g('reptile-amphibian', `olm`),
  ...g(
    'insect-arachnid',
    `
    alderfly antlion booklouse caddisfly dobsonfly firebrat lacewing lanternfly scorpionfly
    silverfish snakefly springtail treehopper mite vinegaroon webspinner pseudoscorpion
    tardigrade larva
  `,
  ),
  ...g(
    'plant',
    `
    bladderwort bluebell butterwort chanterelle edelweiss agaric horsetail lithops propagule
    mangrove papyrus rafflesia arum welwitschia shoot bellflower amanita morel puffball
  `,
  ),
  ...g(
    'food-drink',
    `
    bao canele cannoli churro crepe crumpet dragonfruit eclair empanada falafel focaccia
    madeleine mangosteen mooncake pandoro rambutan ravioli radish samosa starfruit tagine
    tangyuan turnip artichoke boule tiffin carton
  `,
  ),
  ...g(
    'household-object',
    `
    abacus adze anemometer astrolabe barometer beaker bellows bollard bookend calculator canteen
    centrifuge crucible clothespin corkscrew doorbell doorstop drawknife flashlight froe globe
    gyroscope humidifier inkstone kaleidoscope kettlebell keycap megaphone microscope nutcracker
    orrery padlock paperclip periscope pincushion pliers plunger potholder protractor pushpin
    ramekin sextant sieve slippers sneaker spokeshave theodolite thimble toolbox toothbrush
    trivet trowel typewriter caliper goggles seismograph watch chronometer hamper paddle maul
    brayer stirrer hotplate retort holder juicer reamer
    archway bridge gatehouse pagoda shrine streetlamp pagoda-tower windmill waterwheel campfire
    skep birdbath lamppost
    bagpipes balalaika bassoon bongos bugle cabasa castanets cowbell cymbals erhu glockenspiel
    handbell handpan kalimba lyre mandolin maracas metronome ocarina shamisen sitar tuba guiro
    woodblock triangle
    yoyo pulley plumb clamp
  `,
  ),
  ...g('tech-robot', `voltmeter oscilloscope pager counter player`),
  ...g('vehicle', `ferryboat funicular snowplow sweeper trolleybus caravan bathysphere wheelchair`),
  ...g(
    'mythic-character',
    `
    cockatrice domovoi gargoyle hippogriff jackalope mooncalf peryton wolpertinger drake wisp
    orb vault parachute anchor dimension helmet diver cauldron
  `,
  ),
  ...g('nature-cosmic', `pulsar saturn atom diamond snowflake raindrop`),
  ...g('household-object', `paintbrush dovecote tooth`),
  ...g('sea-life', `moonfish`),
  ...g('mythic-character', `shield`),
  // Cell biology — its own corner of nature rather than a fauna bucket.
  ...g('nature-cosmic', `chloroplast mitochondrion lysosome vacuole platelet microspore`),
]) {
  LEXICON.set(w, b);
}

// Exact-slug overrides, for names whose head noun is not a usable bare token.
export const SLUG_OVERRIDES = new Map([
  ['dik-dik', ['mammal', 'dik-dik']],
  ['aye-aye', ['mammal', 'aye-aye']],
  ['tasmanian-devil', ['mammal', 'tasmanian-devil']],
  ['silky-anteater', ['mammal', 'anteater']],
  ['basset-hound', ['mammal', 'basset-hound']],
  ['blue-glaucus', ['sea-life', 'blue-glaucus']],
  ['red-lipped-batfish', ['sea-life', 'batfish']],
  ['giant-isopod', ['sea-life', 'isopod']],
  ['leafy-seadragon', ['sea-life', 'seadragon']],
  ['yellow-boxfish', ['sea-life', 'boxfish']],
  ['thorny-devil', ['reptile-amphibian', 'thorny-devil']],
  ['antlion-larva', ['insect-arachnid', 'antlion']],
  ['velvet-mite', ['insect-arachnid', 'velvet-mite']],
  ['string-of-pearls-plant', ['plant', 'string-of-pearls']],
  ['sensitive-plant', ['plant', 'sensitive-plant']],
  ['resurrection-plant', ['plant', 'resurrection-plant']],
  ['air-plant', ['plant', 'air-plant']],
  ['waterwheel-plant', ['plant', 'waterwheel-plant']],
  ['titan-arum', ['plant', 'titan-arum']],
  ['fly-agaric', ['plant', 'fly-agaric']],
  ['passion-fruit', ['food-drink', 'passion-fruit']],
  ['salak-fruit', ['food-drink', 'salak']],
  ['sesame-ball', ['food-drink', 'sesame-ball']],
  ['cream-puff', ['food-drink', 'cream-puff']],
  ['pain-au-chocolat', ['food-drink', 'pain-au-chocolat']],
  ['pita-pocket', ['food-drink', 'pita']],
  ['milk-carton', ['food-drink', 'milk-carton']],
  ['corn-cob', ['food-drink', 'corn']],
  ['soft-serve', ['food-drink', 'soft-serve']],
  ['sourdough-boule', ['food-drink', 'sourdough']],
  ['space-station', ['tech-robot', 'space-station']],
  ['moonbase-habitat', ['tech-robot', 'moonbase']],
  ['momentum-wheel', ['tech-robot', 'momentum-wheel']],
  ['microcassette-player', ['tech-robot', 'microcassette-player']],
  ['analog-voltmeter', ['tech-robot', 'voltmeter']],
  ['geiger-counter', ['tech-robot', 'geiger-counter']],
  ['walkie-talkie', ['tech-robot', 'walkie-talkie']],
  ['label-maker', ['tech-robot', 'label-maker']],
  ['pocket-watch', ['household-object', 'pocket-watch']],
  ['pocket-barometer', ['household-object', 'barometer']],
  ['safety-goggles', ['household-object', 'goggles']],
  ['vernier-caliper', ['household-object', 'caliper']],
  ['nautical-chronometer', ['household-object', 'chronometer']],
  ['armillary-sphere', ['household-object', 'armillary-sphere']],
  ['hand-spinning-wheel', ['household-object', 'spinning-wheel']],
  ['carding-paddle', ['household-object', 'carding-paddle']],
  ['cobblers-last', ['household-object', 'cobblers-last']],
  ['leatherworkers-maul', ['household-object', 'maul']],
  ['printing-brayer', ['household-object', 'brayer']],
  ['woodblock-printing-block', ['household-object', 'printing-block']],
  ['magnetic-stirrer', ['household-object', 'stirrer']],
  ['laboratory-hotplate', ['household-object', 'hotplate']],
  ['laboratory-retort', ['household-object', 'retort']],
  ['ceramic-crucible', ['household-object', 'crucible']],
  ['chalk-holder', ['household-object', 'chalk-holder']],
  ['citrus-juicer', ['household-object', 'juicer']],
  ['citrus-reamer', ['household-object', 'reamer']],
  ['salad-spinner', ['household-object', 'salad-spinner']],
  ['clothes-iron', ['household-object', 'clothes-iron']],
  ['paint-roller', ['household-object', 'paint-roller']],
  ['round-nose-pliers', ['household-object', 'pliers']],
  ['soldering-iron', ['household-object', 'soldering-iron']],
  ['zipper-pull', ['household-object', 'zipper-pull']],
  ['picnic-hamper', ['household-object', 'hamper']],
  ['lunch-tiffin', ['household-object', 'tiffin']],
  ['blacksmith-bellows', ['household-object', 'bellows']],
  ['brass-microscope', ['household-object', 'microscope']],
  ['tabletop-globe', ['household-object', 'globe']],
  ['weather-vane', ['household-object', 'weather-vane']],
  ['traffic-cone', ['household-object', 'traffic-cone']],
  ['water-tower', ['household-object', 'water-tower']],
  ['covered-bridge', ['household-object', 'covered-bridge']],
  ['roadside-shrine', ['household-object', 'shrine']],
  ['beehive-skep', ['household-object', 'skep']],
  ['origami-crane', ['household-object', 'origami-crane']],
  ['french-horn', ['household-object', 'french-horn']],
  ['triangle-instrument', ['household-object', 'triangle']],
  ['music-note', ['household-object', 'music-note']],
  ['hand-fan', ['household-object', 'hand-fan']],
  ['potters-wheel', ['household-object', 'potters-wheel']],
  ['pottery-wheel', ['household-object', 'potters-wheel']],
  ['pulley-block', ['household-object', 'pulley']],
  ['plumb-bob', ['household-object', 'plumb-bob']],
  ['c-clamp', ['household-object', 'clamp']],
  ['yo-yo', ['household-object', 'yo-yo']],
  ['street-sweeper', ['vehicle', 'street-sweeper']],
  ['magic-caravan', ['vehicle', 'caravan']],
  ['neon-bathysphere', ['vehicle', 'bathysphere']],
  ['lunar-wheelchair', ['vehicle', 'wheelchair']],
  ['astral-turtlecraft', ['vehicle', 'turtlecraft']],
  ['cipher-mothership', ['vehicle', 'mothership']],
  ['library-gargoyle', ['mythic-character', 'gargoyle']],
  ['thundercloud-drake', ['mythic-character', 'drake']],
  ['dream-diver', ['mythic-character', 'dream-diver']],
  ['empathy-bridge', ['mythic-character', 'empathy-bridge']],
  ['empathy-constellation', ['mythic-character', 'empathy-constellation']],
  ['hope-parachute', ['mythic-character', 'hope-parachute']],
  ['resilience-shield', ['mythic-character', 'resilience-shield']],
  ['rift-anchor', ['mythic-character', 'rift-anchor']],
  ['pocket-dimension', ['mythic-character', 'pocket-dimension']],
  ['unity-knot', ['mythic-character', 'unity-knot']],
  ['memory-vault', ['mythic-character', 'memory-vault']],
  ['archive-orb', ['mythic-character', 'archive-orb']],
  ['living-card-stack', ['mythic-character', 'card-stack']],
  ['iron-wisp', ['mythic-character', 'iron-wisp']],
  ['chrono-helmet', ['mythic-character', 'chrono-helmet']],
  ['spell-wheel', ['mythic-character', 'spell-wheel']],
  ['wonder-cauldron', ['mythic-character', 'cauldron']],
  ['mana-battery', ['mythic-character', 'mana-battery']],
  ['water-drop', ['nature-cosmic', 'water-drop']],
  ['coccus-bacterium', ['sea-life', 'bacterium']],
  ['bdelloid-rotifer', ['sea-life', 'rotifer']],
  ['papyrus-plant', ['plant', 'papyrus']],
  ['horsetail-shoot', ['plant', 'horsetail']],
  ['mangrove-propagule', ['plant', 'mangrove']],
  ['patagonian-mara', ['mammal', 'mara']],
  ['sunda-colugo', ['mammal', 'colugo']],
  ['ring-tailed-coati', ['mammal', 'coati']],
  ['collared-peccary', ['mammal', 'peccary']],
  ['african-civet', ['mammal', 'civet']],
  ['blue-duiker', ['mammal', 'duiker']],
  ['greater-bilby', ['mammal', 'bilby']],
  ['greater-kudu', ['mammal', 'kudu']],
  ['southern-gerenuk', ['mammal', 'gerenuk']],
  ['southern-pudu', ['mammal', 'pudu']],
  ['sichuan-takin', ['mammal', 'takin']],
  ['lowland-anoa', ['mammal', 'anoa']],
  ['lowland-streaked-tenrec', ['mammal', 'tenrec']],
  ['pyrenean-desman', ['mammal', 'desman']],
]);

export function parseKey(key) {
  const base = key.replace(/\.png$/, '');
  const m = /^([0-9a-f]{16})-(.+)$/.exec(base);
  if (!m) throw new Error(`Unexpected key: ${key}`);
  const [, hash, rest] = m;
  const variant = /-(\d+)$/.exec(rest);
  const slug = variant ? rest.slice(0, -variant[0].length) : rest;
  return { hash, slug, variant: variant ? Number(variant[1]) : 1 };
}

export function classify(slug) {
  const override = SLUG_OVERRIDES.get(slug);
  if (override) return { level1: override[0], level2: override[1] };

  const tokens = slug.split('-');

  // Prefer the LAST lexicon hit: the corpus puts the head noun last in the
  // common compounds ("nebelung-cat", "smooth-cheek-raccoon", "rice-cooker-bot").
  let subject = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (LEXICON.has(tokens[i])) {
      subject = tokens[i];
      break;
    }
  }
  // Two-token compounds the lexicon knows as one word ("venus-flytrap").
  if (!subject) {
    for (let i = 0; i < tokens.length - 1; i++) {
      const pair = `${tokens[i]}${tokens[i + 1]}`;
      if (LEXICON.has(pair)) {
        subject = pair;
        break;
      }
    }
  }
  if (subject) return { level1: LEXICON.get(subject), level2: subject };

  // Unmatched: fall back to the most meaningful token so level 2 is never empty.
  const content = tokens.filter((t) => !MODIFIERS.has(t) && !/^\d+$/.test(t));
  return { level1: 'other', level2: content.at(-1) ?? tokens.at(-1) };
}
