#! /bin/bash

# Drop large files we don't need unless we are using the jetbrains editor
sudo rm -rf /workspaces/.codespaces/shared/editors/jetbrains

# Install required libraries
sudo apt-get update
sudo apt-get install -y libblas3 
sudo apt-get install -y liblapack3
