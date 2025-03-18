# dependencies
```
sudo apt-get install espeak
pip install piper-tts       # better TTS
```

# Setting up Reolink camera
+ Install Reolink app on Android/iPhone
+ Use the app to scan the QR code on the camera
+ Create user/pass
+ Disable illegal login lockout
+ Name device "Jurassic Camera"
+ Connect it to wifi
+ Goto Advanced Settings in Jurassic Camera -> Device Info -> Network Info and enable HTTPS
+ To test, goto camera IP and enter login credentials

## Connecting via client software
+ Download [this specific version of the Reolink windows app](https://home-cdn.reolink.us/wp-content/uploads/2022/10/131121581665660118.97.exe?download_name=ReolinkClient882.exe)
+ Download [Bottles](https://dl.flathub.org/repo/appstream/com.usebottles.bottles.flatpakref)


## Settings
admin/jPark88912
Name: Jurassic Camera

## Database

+ database
    + scenes
        + 001 - see dinosaurs
            + movie.mp4
            + thumbnail.jpg
            + A - shot description
                + shot.mp4
                + thumbnail.jpg
            + B - ...
            + C - ...
            + D - ...
        + 002 - run from dinosaurs
            + A - shot description
            + B - ...
            + C - ...


## shots.json

The notation for directions:
*this is an action* such as: *you look at Dr. Grant*
_this is a line of dialogue_ such as _It's... it's a dinosar_

## Process for each scene
+ Call actors to the stage
...
+ Action
    + 