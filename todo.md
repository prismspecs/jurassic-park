## to do

- remove unncessary things

- camera stuff

  - fix recording (it is using the wrong sort of device ID)

- actor telepromter reads no scene is loaded until the scene starts but it should refresh or whatever when it begins

- capture video from actor phones

- update scenes.json

  - remove directions (this is now in the video files)
  - add camera movements
    - https://docs.google.com/presentation/d/1AfB2Eh2Di7RI5x7QjNFDiLoypyYsyMnt9xGKXs9W35s/edit
  - add ins and outs which will be used by editing module
    - these are also in the document. there are F and B and A (above) and U (underneath)
    - with Above and Underneath these are shot as a separate take
    - there is also a final separate take for each dinosaur

- use skeletal tracking to cut actors out

## Scene Recording

play the scene

some sort of 3 - 2 - 1 action moment (this should be computerized so that it is synced rather than the actor)

actors get their teleprompter stuff

recording begins

camera uses the scene.json file to zoom, move, etc. (?)

recording ends

video files are sent to the editing module (to be developed)

## Editor

The editor should intake the video and audio from the Scene Recording. It should then use the scenes.json data ins and outs to cut the footage.

## Video Player

Simple video player functionality to play the intro video, etc.

This should also have the ability to use a camera source with facial recognition of the audience. The faces of the audience will be randomly inserted on top of the video at selected moments.

## Onboarding App

Add the response stuff
