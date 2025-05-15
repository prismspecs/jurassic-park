## to do

### Interface

+ add dinosaur eating animation
+ bigger dino torso

+ Create a "shuffle" effect where it draws every participant's photo on the canvas. It should show each one individually for .5 seconds, then show them all together in a grid. These photos come from the actors/ dir in the database. This should occur when the user clicks Draft Actors. After showing all of them in a grid for 2 seconds, it should move on to showing the actor cards like it does now.

+ FX chains. Introduce "effects" to each shot in scenes.json which include the default camera setup, etc. for that shot.

### Functional

- The third time the scene is run, the audience hums along

- capture video from actor phones

  - The character teleprompters run on participants phones. I would like for them to sometimes record the participants who will be looking at their phone. I have added "capture-camera" to the @scenes.json file for each character. At in: 1, out: 5 it should record the participant from 1 second to 5 seconds once the scene has begun (Action!). I also need a way for this video to be sent to the server. We can store it on recordings/phone-vids. Because it will later be cut into a longer video and the timecodes should correspond (as in if it records from 0:01 to 0:05 in the scene, it will be cut into that position) and we need a way to store this meta data. So in the records/phone-vids directory there should be a json file which stores this list of shots that includes the character, the scene, and the time in/out.

- refactor the endpoints. some use /api/ prefix. /camera/ does not, for example. I should update everything to use /api/

- remove unncessary things

## Editor

The editor should intake the video and audio from the Scene Recording. It should then use the scenes.json data ins and outs to cut the footage.

## Video Player

Simple video player functionality to play the intro video, etc.

This should also have the ability to use a camera source with facial recognition of the audience. The faces of the audience will be randomly inserted on top of the video at selected moments.

## Post-onboarding

Flash all the participants on the screen with their names. The AI voice actor will voice this over.
I guess this means I will need to create a way to create "batches" of participants
