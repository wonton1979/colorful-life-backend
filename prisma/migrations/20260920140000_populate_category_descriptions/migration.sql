BEGIN;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Category") <> 13 THEN
    RAISE EXCEPTION 'Expected exactly 13 established Categories before editorial description update';
  END IF;
END $$;

UPDATE "Category" SET "description" = CASE "name"
  WHEN 'Harry Potter' THEN 'Step into a world of spells, secret rooms and stirring adventures, where every build holds a little magic.'
  WHEN 'Star Wars' THEN 'Travel to galaxies far away, bringing daring journeys, loyal companions and legendary moments to life.'
  WHEN 'Friends' THEN 'Find bright, everyday adventures filled with friendship, creativity and cheerful places to share.'
  WHEN 'City' THEN 'Explore busy streets, helpful heroes and familiar scenes where there is always another story unfolding.'
  WHEN 'Disney' THEN 'Revisit beloved tales and build a little wonder, with familiar characters and magical moments around every corner.'
  WHEN 'Marvel' THEN 'Assemble a world of brave heroes, bold choices and extraordinary adventures ready to leap into action.'
  WHEN 'Jurassic World' THEN 'Enter a prehistoric world of mighty dinosaurs, untamed landscapes and exciting discoveries.'
  WHEN 'Flowers & Botanicals' THEN 'Bring a little calm indoors with graceful blooms, leafy treasures and nature-inspired details to enjoy.'
  WHEN 'NINJAGO' THEN 'Train alongside courageous ninja, discover ancient secrets and build adventures full of skill, spirit and surprise.'
  WHEN 'DC & Batman' THEN 'Enter the night with legendary heroes, daring rescues and Gotham adventures waiting to unfold.'
  WHEN 'Vehicles' THEN 'Feel the joy of movement with speedy cars, powerful machines and journeys limited only by imagination.'
  WHEN 'Creator' THEN 'Let curiosity lead the way, rebuilding familiar ideas into something wonderfully unexpected.'
  WHEN 'Others' THEN 'Wander into a collection of delightful worlds, unusual ideas and small surprises waiting to be discovered.'
END
WHERE "name" IN (
  'Harry Potter', 'Star Wars', 'Friends', 'City', 'Disney', 'Marvel',
  'Jurassic World', 'Flowers & Botanicals', 'NINJAGO', 'DC & Batman',
  'Vehicles', 'Creator', 'Others'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Category" WHERE "description" IS NULL) THEN
    RAISE EXCEPTION 'Established Categories must all have editorial descriptions';
  END IF;
END $$;

COMMIT;
